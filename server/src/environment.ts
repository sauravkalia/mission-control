import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// What the fleet runs with: the user-scope MCP servers and skills available to
// every agent. Read live from ~/.claude so it reflects the real environment.

export type McpInfo = { name: string; type: string; detail: string }
export type SkillInfo = { name: string; description: string }
export type Environment = { mcp: McpInfo[]; skills: SkillInfo[] }

const CLAUDE_JSON = join(homedir(), '.claude.json')
const SKILLS_DIR = join(homedir(), '.claude', 'skills')

const readMcp = (): McpInfo[] => {
  try {
    const cfg = JSON.parse(readFileSync(CLAUDE_JSON, 'utf8')) as {
      mcpServers?: Record<string, { type?: string; url?: string; command?: string }>
    }
    const servers = cfg.mcpServers ?? {}
    return Object.entries(servers)
      .map(([name, s]) => ({
        name,
        type: s.type ?? (s.command ? 'stdio' : 'http'),
        detail: s.url ?? s.command ?? '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

// Pull `name` and `description` from a SKILL.md frontmatter block, tolerating
// inline, folded (>) and block (|) scalar styles.
const parseSkill = (md: string, fallbackName: string): SkillInfo => {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? ''
  const lines = fm.split('\n')
  const name = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim() ?? fallbackName
  let description = ''
  const descIdx = lines.findIndex(l => /^description:/.test(l))
  if (descIdx !== -1) {
    const inline = /^description:\s*(.*)$/.exec(lines[descIdx] ?? '')?.[1]?.trim() ?? ''
    if (inline && inline !== '>' && inline !== '|' && inline !== '>-' && inline !== '|-') {
      description = inline
    } else {
      const collected: string[] = []
      for (let i = descIdx + 1; i < lines.length; i += 1) {
        const l = lines[i] ?? ''
        if (/^\s+\S/.test(l)) collected.push(l.trim())
        else break
      }
      description = collected.join(' ')
    }
  }
  return { name, description: description.slice(0, 240) }
}

const readSkills = (): SkillInfo[] => {
  if (!existsSync(SKILLS_DIR)) return []
  const skills: SkillInfo[] = []
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillMd = join(SKILLS_DIR, entry.name, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    try {
      skills.push(parseSkill(readFileSync(skillMd, 'utf8'), entry.name))
    } catch {
      skills.push({ name: entry.name, description: '' })
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

export const readEnvironment = (): Environment => ({ mcp: readMcp(), skills: readSkills() })
