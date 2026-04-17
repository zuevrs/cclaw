import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const distModulePath = path.join(root, "dist", "content", "harnesses-doc.js");
const docsOutputPath = path.join(root, "docs", "harnesses.md");

const { harnessIntegrationDocMarkdown } = await import(pathToFileURL(distModulePath).href);
const markdown = harnessIntegrationDocMarkdown();
await fs.writeFile(docsOutputPath, `${markdown}\n`, "utf8");
process.stdout.write(`Updated ${path.relative(root, docsOutputPath)} from dist/content/harnesses-doc.js\n`);

