import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'

type ChapterCommitDb = Pick<DatabaseSync, 'exec'> & {
  prepare?: (sql: string) => StatementSync
  prepareSync?: (sql: string) => StatementSync
}

function prepareStatement(db: ChapterCommitDb, sql: string): StatementSync {
  const prepare = db.prepare ?? db.prepareSync
  if (!prepare) {
    throw new Error('SQLite database does not expose prepare/prepareSync')
  }
  return prepare.call(db, sql)
}

export function commitChapterEditInDb(
  db: ChapterCommitDb,
  projectId: string,
  chapterId: string,
  oldContent: string,
  newContent: string
): { versionId: string } {
  const row = prepareStatement(db,
    'SELECT title, summary, status, word_target, content FROM chapters WHERE id = ? AND project_id = ?'
  ).get(chapterId, projectId) as Record<string, unknown> | undefined

  if (!row) {
    throw new Error(`Chapter not found: ${chapterId}`)
  }
  if (String(row.content) !== oldContent) {
    throw new Error('章节正文在暂存后已发生变化，请重新生成修改提案。')
  }

  const versionId = randomUUID()
  db.exec('BEGIN')
  try {
    prepareStatement(db, `
      INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      projectId,
      chapterId,
      String(row.title),
      String(row.summary),
      String(row.status),
      String(row.word_target),
      oldContent,
      new Date().toISOString()
    )

    const result = prepareStatement(db, 'UPDATE chapters SET content = ? WHERE id = ? AND project_id = ? AND content = ?')
      .run(newContent, chapterId, projectId, oldContent)
    if (result.changes === 0) {
      throw new Error('章节正文在暂存后已发生变化，请重新生成修改提案。')
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return { versionId }
}
