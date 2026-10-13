#!/usr/bin/env node
import { run } from "../dist/cli.js";

const code = await run(process.argv.slice(2), process.cwd());
process.exitCode = code;
