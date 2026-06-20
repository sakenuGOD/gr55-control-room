import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

let registered = false;

export function registerTsExtensionLoader() {
  if (registered) {
    return;
  }

  registered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        const resolved = resolveTsSpecifier(specifier, context.parentURL);
        if (resolved) {
          return {
            url: pathToFileURL(resolved).href,
            shortCircuit: true,
          };
        }

        throw error;
      }
    },
    load(url, context, nextLoad) {
      if (!url.endsWith(".ts") && !url.endsWith(".tsx")) {
        return nextLoad(url, context);
      }

      const source = readFileSync(fileURLToPath(url), "utf8");
      const result = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
          isolatedModules: true,
          sourceMap: false,
        },
        fileName: fileURLToPath(url),
      });

      return {
        format: "module",
        shortCircuit: true,
        source: result.outputText,
      };
    },
  });
}

function resolveTsSpecifier(specifier, parentURL) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return null;
  }

  const basePath = specifier.startsWith("/")
    ? specifier
    : resolvePath(dirname(fileURLToPath(parentURL)), specifier);
  const candidates = extname(basePath)
    ? [basePath]
    : [`${basePath}.ts`, `${basePath}.tsx`, `${basePath}/index.ts`, `${basePath}/index.tsx`];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
