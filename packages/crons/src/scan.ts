import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { validateCloudflareCron } from "./cron-expr.js";
import type { CronJob } from "./types.js";
export const CRON_DIR = "crons";
export const CRON_EXTS = [".ts", ".mts", ".js", ".mjs"] as const;

/**
 * Synchronous cron check against Cloudflare's Cron Trigger grammar.
 * Accepts Quartz extensions (`L`, `LW`, `15W`, `2#2`, `?`) and DOW names;
 * rejects out-of-range values and non-5-field expressions.
 */
export function isCronExpression(value: string): boolean {
  return validateCloudflareCron(value) === null;
}

function unwrap(node: ts.Node, allowNonNull = true): ts.Node {
  while (
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) ||
    (allowNonNull && ts.isNonNullExpression(node))
  ) node = node.expression;
  return node;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}

function isConstant(node: ts.VariableDeclaration): boolean {
  return ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
}

function analyzeSource(source: string, filename: string) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const program = ts.createProgram([filename], { noResolve: true, noLib: true, allowJs: true }, {
    getSourceFile: (name) => name === filename ? file : undefined,
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (name) => name === filename,
    readFile: (name) => name === filename ? source : undefined,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  });
  const checker = program.getTypeChecker();
  const exported = new Map<string, ts.Node>();
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      exported.set("default", statement.expression);
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly &&
      statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly && element.name.text !== "cron") exported.set(element.name.text, statement.moduleSpecifier ? element : element.propertyName ?? element.name);
      }
    } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) exported.set("default", statement);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exported.set(declaration.name.text, declaration);
        }
      } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
        exported.set(statement.name.text, statement);
      }
    }
  }

  function declarationOf(node: ts.Identifier): ts.Declaration | undefined {
    let symbol = checker.getSymbolAtLocation(node);
    let declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (declaration && ts.isExportSpecifier(declaration) && !declaration.parent.parent.moduleSpecifier) {
      symbol = checker.getExportSpecifierLocalTargetSymbol(declaration);
      declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    }
    if (declaration && ts.isFunctionDeclaration(declaration)) {
      return symbol?.declarations?.find((candidate) => ts.isFunctionDeclaration(candidate) && candidate.body) ?? declaration;
    }
    return declaration;
  }

  function importKind(node: ts.Node, seen = new Set<ts.Node>()): "wrapper" | "namespace" | undefined {
    node = unwrap(node);
    if (seen.has(node)) return undefined;
    seen.add(node);
    if (ts.isIdentifier(node)) {
      const declaration = declarationOf(node);
      if (!declaration) return undefined;
      if (ts.isVariableDeclaration(declaration) && isConstant(declaration) && declaration.initializer) {
        return importKind(declaration.initializer, seen);
      }
      if (ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration)) {
        const clause = ts.isImportSpecifier(declaration) ? declaration.parent.parent : declaration.parent;
        const imported = clause.parent;
        if (clause.isTypeOnly || !ts.isImportDeclaration(imported) || !ts.isStringLiteral(imported.moduleSpecifier) ||
          !["void", "void/handler"].includes(imported.moduleSpecifier.text)) return undefined;
        if (ts.isNamespaceImport(declaration)) return "namespace";
        if (!declaration.isTypeOnly && (declaration.propertyName ?? declaration.name).text === "defineScheduled") return "wrapper";
      }
    } else if (ts.isPropertyAccessExpression(node) && node.name.text === "defineScheduled" &&
      importKind(node.expression, seen) === "namespace") return "wrapper";
    else if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      const property = unwrap(node.argumentExpression);
      if (ts.isStringLiteral(property) && property.text === "defineScheduled" &&
        importKind(node.expression, seen) === "namespace") return "wrapper";
    }
    return undefined;
  }

  function callable(node: ts.Node, seen = new Set<ts.Node>()): boolean | undefined {
    node = unwrap(node);
    if (seen.has(node)) return undefined;
    seen.add(node);
    if (hasModifier(node, ts.SyntaxKind.DeclareKeyword)) return false;
    if (ts.isFunctionDeclaration(node)) return node.body !== undefined;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
    if (ts.isIdentifier(node)) {
      const declaration = declarationOf(node);
      return declaration ? callable(declaration, seen) : node.text === "undefined" ? false : undefined;
    }
    if (ts.isVariableDeclaration(node)) {
      return isConstant(node) && node.initializer ? callable(node.initializer, seen) : undefined;
    }
    if (ts.isImportClause(node)) return node.isTypeOnly ? false : undefined;
    if (ts.isImportSpecifier(node)) return node.isTypeOnly || node.parent.parent.isTypeOnly ? false : undefined;
    if (ts.isNamespaceImport(node)) return node.parent.isTypeOnly ? false : undefined;
    if (ts.isCallExpression(node) && importKind(node.expression) === "wrapper") {
      const argument = node.arguments[0];
      return argument ? callable(argument, seen) : false;
    }
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
      ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) || ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node) || ts.isLiteralExpression(node) || ts.isTemplateExpression(node) ||
      ts.isPrefixUnaryExpression(node) || ts.isVoidExpression(node) || ts.isTypeOfExpression(node) ||
      node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword) return false;
    return undefined;
  }

  let usesDefineScheduled = false;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && importKind(node.expression) === "wrapper") usesDefineScheduled = true;
    ts.forEachChild(node, visit);
  }
  visit(file);
  const syntaxError = program.getSyntacticDiagnostics(file)[0];
  if (syntaxError) return { expressions: [], error: `invalid cron source: ${ts.flattenDiagnosticMessageText(syntaxError.messageText, " ")}`, usesDefineScheduled };
  let cron = exported.get("cron");
  if (cron && ts.isIdentifier(cron)) cron = declarationOf(cron);
  const initializer = cron && ts.isVariableDeclaration(cron) && isConstant(cron) ? cron.initializer : undefined;
  const parsed = parseExpressions(initializer, exported.has("cron"));
  const handler = exported.get("default");
  const handlerError = !handler ? "missing default handler export" : callable(handler) === false ? "default handler must be callable" : undefined;
  return { ...parsed, error: parsed.error ?? handlerError, usesDefineScheduled };
}

function cronError(expr: string): string {
  return validateCloudflareCron(expr) ?? `invalid cron expression: "${expr}"`;
}

function parseExpressions(initializer: ts.Expression | undefined, hasExport: boolean): { expressions: string[]; error?: string } {
  if (!hasExport) return { expressions: [], error: "missing `export const cron`: void build fails for files in crons/ without a cron export" };
  const unsupported = { expressions: [], error: "unsupported cron export: use a string literal or array of string literals" };
  if (!initializer) return unsupported;
  const node = unwrap(initializer, false);
  const elements = ts.isArrayLiteralExpression(node) ? node.elements : [node];
  if (elements.length === 0) return { expressions: [], error: "empty cron array: export at least one expression" };
  const expressions: string[] = [];
  for (const element of elements) {
    const literal = unwrap(element, false);
    if (!ts.isStringLiteral(literal) && !ts.isNoSubstitutionTemplateLiteral(literal)) return unsupported;
    const expression = literal.text.trim();
    if (!isCronExpression(expression)) return { expressions: [], error: cronError(expression) };
    expressions.push(expression);
  }
  return { expressions: [...new Set(expressions)] };
}

function walk(dir: string, root: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    // Void ignores files and directories starting with `_`.
    if (e.startsWith("_")) continue;
    const p = join(dir, e);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      walk(p, root, out);
    } else if (CRON_EXTS.some((x) => p.endsWith(x))) {
      if (p.endsWith(".d.ts")) continue;
      const rel = relative(root, resolve(p)).replace(/\\/g, "/");
      if (rel.startsWith("..") || rel.includes("../")) continue;
      out.push(p);
    }
  }
  return out;
}

export function scanCronFiles(
  appRoot: string,
  opts: { disabled?: Set<string> | string[] } = {},
): CronJob[] {
  const files = walk(join(appRoot, CRON_DIR), appRoot).sort();
  const disabled = new Set(opts.disabled ?? []);
  const jobs: CronJob[] = files.map((abs) => {
    const rel = relative(appRoot, abs).replace(/\\/g, "/");
    // Void names jobs by their path inside crons/ without the extension
    // (`crons/billing/daily.ts` → `billing/daily`), so nested files never collide.
    const name = rel.replace(new RegExp(`^${CRON_DIR}/`), "").replace(/\.[^./]+$/, "");
    let source = "";
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      return {
        path: rel,
        name,
        expressions: [],
        status: "invalid",
        error: "unreadable file",
        usesDefineScheduled: false,
        sharedExpression: false,
      } satisfies CronJob;
    }
    const { expressions, error, usesDefineScheduled } = analyzeSource(source, abs);
    if (error !== undefined || expressions.length === 0) {
      return {
        path: rel,
        name,
        expressions: [],
        status: "invalid",
        error,
        usesDefineScheduled,
        sharedExpression: false,
      } satisfies CronJob;
    }
    return {
      path: rel,
      name,
      expressions,
      status: disabled.has(name) || disabled.has(rel) ? "disabled" : "active",
      usesDefineScheduled,
      sharedExpression: false,
    } satisfies CronJob;
  });

  const byName = new Map<string, CronJob[]>();
  for (const job of jobs) {
    const siblings = byName.get(job.name) ?? [];
    siblings.push(job);
    byName.set(job.name, siblings);
  }
  for (const [name, siblings] of byName) {
    if (siblings.length < 2) continue;
    for (const job of siblings) {
      job.status = "invalid";
      job.error = `duplicate cron job name "${name}": ${siblings.map((sibling) => sibling.path).join(", ")}`;
      job.expressions = [];
    }
  }

  // Jobs sharing one expression each run once per invocation but count
  // once toward the 100-expression platform limit — flag the overlap.
  const counts = new Map<string, number>();
  for (const j of jobs) for (const e of j.expressions) counts.set(e, (counts.get(e) ?? 0) + 1);
  for (const j of jobs) {
    if (j.expressions.some((e) => (counts.get(e) ?? 0) > 1)) j.sharedExpression = true;
  }
  return jobs;
}
