import { readdir, readFile, stat } from "node:fs/promises"
import { resolve, dirname } from "node:path"

const roots = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md", "docs", "examples/todoapp/README.md", "examples/blogapp/README.md", "examples/blogapp/PACKAGE_AUDIT.md"]
const files = []
const visit = async (path) => {
  if ((await stat(path)).isDirectory()) {
    for (const child of await readdir(path)) await visit(`${path}/${child}`)
  } else if (path.endsWith(".md")) files.push(path)
}
for (const root of roots) await visit(root)
for (const file of files) {
  const source = await readFile(file, "utf8")
  for (const match of source.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
    const target = match[1]
    if (/^[a-z]+:/.test(target)) continue
    const [path, hash] = target.split("#")
    const absolute = path ? resolve(dirname(file), decodeURIComponent(path)) : resolve(file)
    const info = await stat(absolute).catch(() => { throw new Error(`Broken link in ${file}: ${target}`) })
    if (hash && info.isFile() && absolute.endsWith(".md")) {
      const content = await readFile(absolute, "utf8")
      const headings = [...content.matchAll(/^#{1,6} (.+)$/gm)].map((heading) => heading[1].toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s/g, "-"))
      if (!headings.includes(decodeURIComponent(hash))) throw new Error(`Broken heading link in ${file}: ${target}`)
    }
  }
}
console.log(`Checked local links in ${files.length} Markdown files`)
