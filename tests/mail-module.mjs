import { readFile } from "node:fs/promises";
import ts from "typescript";
const cache = new Map();
export async function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let source = await readFile(url, "utf8");
  const imports = [...source.matchAll(/from (["'])([^"']+)\1/g)];
  for (const [, quote, path] of imports) {
    const resolved = path.startsWith(".") ? await moduleUrl(new URL(/\.[cm]?[jt]sx?$/.test(path) ? path : `${path}.ts`, url)) : import.meta.resolve(path);
    source = source.replaceAll(`from ${quote}${path}${quote}`, `from ${JSON.stringify(resolved)}`);
  }
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const result = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  cache.set(url.href, result);
  return result;
}
