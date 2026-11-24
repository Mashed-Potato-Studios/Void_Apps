import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { validateQueueName } from "./queue-name.js";

export { validateQueueName } from "./queue-name.js";

/**
 * Static inspection of a Void app's `queues/` directory.
 *
 * Contract source: https://void.cloud/guide/queues. Nothing here executes a
 * queue module or resolves bindings — it parses source so deploys and local
 * checks stay statically analyzable. Queue creation, consumers, and ack/retry
 * remain the platform's and the consuming app's responsibility.
 */

export const QUEUE_DIR = "queues";
export const QUEUE_EXTS = [".ts", ".mts", ".js", ".mjs"] as const;

export interface QueueConsumerOptions {
  maxBatchSize?: number;
  maxBatchTimeout?: number;
  maxConcurrency?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface QueueDefinition {
  /** Path relative to the app, e.g. `queues/order/notifications.ts`. */
  path: string;
  /** Void queue name derived from the path, e.g. `order-notifications`. */
  name: string;
  status: "active" | "invalid";
  error?: string;
  usesDefineQueue: boolean;
  options: QueueConsumerOptions;
}

const OPTION_SPECS: Record<keyof QueueConsumerOptions, { min: number; max?: number }> = {
  maxBatchSize: { min: 1 },
  maxBatchTimeout: { min: 0 },
  maxConcurrency: { min: 1, max: 250 },
  maxRetries: { min: 0 },
  retryDelay: { min: 0 },
};
const OPTION_KEYS = Object.keys(OPTION_SPECS) as Array<keyof QueueConsumerOptions>;

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function unwrap(node: ts.Node): ts.Node {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}

interface Analysis {
  options: QueueConsumerOptions;
  usesDefineQueue: boolean;
  error?: string;
}

function analyzeSource(source: string, filename: string): Analysis {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const program = ts.createProgram([filename], { noResolve: true, noLib: true, allowJs: true }, {
    getSourceFile: (name) => (name === filename ? file : undefined),
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (name) => name === filename,
    readFile: (name) => (name === filename ? source : undefined),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  });
  const syntaxError = program.getSyntacticDiagnostics(file)[0];
  if (syntaxError) {
    return { options: {}, usesDefineQueue: false, error: `invalid queue source: ${ts.flattenDiagnosticMessageText(syntaxError.messageText, " ")}` };
  }

  const locals = new Map<string, ts.Node>();
  const defineQueueNames = new Set<string>();
  let queueNamespace: string | undefined;
  let handler: ts.Node | undefined;
  const options = new Map<keyof QueueConsumerOptions, ts.Expression | undefined>();
  const reexports = new Set<keyof QueueConsumerOptions>();

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
      ["void", "void/handler"].includes(statement.moduleSpecifier.text)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === "defineQueue") defineQueueNames.add(element.name.text);
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        queueNamespace = bindings.name.text;
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        locals.set(name, declaration);
        if (hasModifier(statement, ts.SyntaxKind.ExportKeyword) && OPTION_KEYS.includes(name as keyof QueueConsumerOptions)) {
          options.set(name as keyof QueueConsumerOptions, declaration.initializer);
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      locals.set(statement.name.text, statement);
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      handler = statement.expression;
    } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const name = element.name.text;
        if (OPTION_KEYS.includes(name as keyof QueueConsumerOptions)) reexports.add(name as keyof QueueConsumerOptions);
      }
    }
  }

  const isDefineQueueCall = (node: ts.Node): node is ts.CallExpression => {
    if (!ts.isCallExpression(node)) return false;
    const callee = unwrap(node.expression);
    if (ts.isIdentifier(callee)) return defineQueueNames.has(callee.text);
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && queueNamespace !== undefined) {
      return callee.expression.text === queueNamespace && callee.name.text === "defineQueue";
    }
    return false;
  };

  const callable = (node: ts.Node, seen = new Set<ts.Node>()): boolean => {
    const current = unwrap(node);
    if (seen.has(current)) return false;
    seen.add(current);
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isFunctionDeclaration(current)) return true;
    if (ts.isIdentifier(current)) {
      const declaration = locals.get(current.text);
      return declaration ? callable(declaration, seen) : false;
    }
    if (ts.isVariableDeclaration(current)) return current.initializer ? callable(current.initializer, seen) : false;
    if (isDefineQueueCall(current)) {
      const argument = current.arguments[0];
      return argument ? callable(argument, seen) : false;
    }
    return false;
  };

  let usesDefineQueue = false;
  const visit = (node: ts.Node): void => {
    if (isDefineQueueCall(node)) usesDefineQueue = true;
    ts.forEachChild(node, visit);
  };
  visit(file);

  const problems: string[] = [];
  if (handler === undefined) problems.push("missing default handler export");
  else if (!callable(handler)) problems.push("default queue handler must be callable");
  for (const key of reexports) problems.push(`${key} is re-exported; declare each option as a whole-number literal in the queue file`);
  if (reexports.size > 0) return { options: {}, usesDefineQueue, error: problems.join("; ") };

  const resolved: QueueConsumerOptions = {};
  for (const [key, initializer] of options) {
    if (initializer === undefined) {
      problems.push(`${key} must be a whole-number literal`);
      continue;
    }
    const literal = unwrap(initializer);
    if (!ts.isNumericLiteral(literal) || !/^\d+$/.test(literal.text)) {
      problems.push(`${key} must be a whole-number literal (computed values aren't supported)`);
      continue;
    }
    const value = Number(literal.text);
    const spec = OPTION_SPECS[key];
    if (!Number.isSafeInteger(value) || value < spec.min || (spec.max !== undefined && value > spec.max)) {
      const range = spec.max !== undefined ? `${spec.min}-${spec.max}` : `>= ${spec.min}`;
      problems.push(`${key} must be a whole number ${range}`);
      continue;
    }
    resolved[key] = value;
  }
  return { options: resolved, usesDefineQueue, error: problems.length > 0 ? problems.join("; ") : undefined };
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    // Void ignores files and directories starting with `_`.
    if (entry.startsWith("_")) continue;
    const path = join(dir, entry);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walk(path, out);
    else if (QUEUE_EXTS.some((extension) => path.endsWith(extension)) && !path.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** Scan `queues/` without executing queue modules. */
export function scanQueueFiles(appRoot: string): QueueDefinition[] {
  const files = walk(join(appRoot, QUEUE_DIR)).sort();
  const queues = files.map((absolute): QueueDefinition => {
    const path = relative(appRoot, absolute).replace(/\\/g, "/");
    const name = path
      .replace(new RegExp(`^${QUEUE_DIR}/`), "")
      .replace(/\.[^./]+$/, "")
      .split("/")
      .join("-");
    let source = "";
    try {
      source = readFileSync(absolute, "utf8");
    } catch {
      return { path, name, status: "invalid", error: "unreadable file", usesDefineQueue: false, options: {} };
    }
    const analysis = analyzeSource(source, absolute);
    const nameProblem = validateQueueName(name);
    const error = nameProblem ?? analysis.error;
    if (error !== undefined) {
      return { path, name, status: "invalid", error, usesDefineQueue: analysis.usesDefineQueue, options: analysis.options };
    }
    return { path, name, status: "active", usesDefineQueue: analysis.usesDefineQueue, options: analysis.options };
  });

  const byName = new Map<string, QueueDefinition[]>();
  for (const queue of queues) {
    const siblings = byName.get(queue.name) ?? [];
    siblings.push(queue);
    byName.set(queue.name, siblings);
  }
  for (const [name, siblings] of byName) {
    if (siblings.length < 2) continue;
    for (const queue of siblings) {
      queue.status = "invalid";
      queue.error = `duplicate queue name "${name}": ${siblings.map((sibling) => sibling.path).join(", ")}`;
    }
  }
  return queues;
}

/** Counts for a scanned app, matching the shape used by CLI summaries. */
export function queueCounts(queues: QueueDefinition[]): { queues: number; active: number; invalid: number } {
  return {
    queues: queues.length,
    active: queues.filter((queue) => queue.status === "active").length,
    invalid: queues.filter((queue) => queue.status === "invalid").length,
  };
}
