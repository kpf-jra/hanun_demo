import fs from "fs";
import { pathToFileURL } from "url";

const file = new URL(
  "../apps/news-verification/news-verification.js",
  import.meta.url
);
try {
  await import(pathToFileURL(file));
  console.log("import ok");
} catch (e) {
  console.error("import fail", e.message);
}

try {
  const code = fs.readFileSync(file, "utf8");
  new Function(code);
  console.log("function ok");
} catch (e) {
  console.error("function fail", e.message);
}
