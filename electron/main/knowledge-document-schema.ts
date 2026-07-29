import type { DatabaseSync } from 'node:sqlite'

/** 修正历史知识文档的作用域：参考资料全局共享，旧项目知识归入当前有效项目。 */
export function migrateKnowledgeDocumentScopes(db: DatabaseSync): void {
  const defaultProjectId =
    (
      db.prepare(`
        SELECT selected_project_id AS projectId
        FROM app_settings
        WHERE id = 1
          AND selected_project_id IN (SELECT id FROM projects)
      `).get() as
        | { projectId?: string }
        | undefined
    )?.projectId
    || (db.prepare(`SELECT id FROM projects ORDER BY rowid ASC LIMIT 1`).get() as { id?: string } | undefined)?.id
    || ''

  db.exec(`
    UPDATE knowledge_documents
    SET project_id = ''
    WHERE source_type IN ('reference-summary', 'reference-chunk');
  `)
  if (defaultProjectId) {
    db.prepare(`
      UPDATE knowledge_documents
      SET project_id = ?
      WHERE COALESCE(project_id, '') = ''
        AND source_type IN ('workflow-document', 'canon-fact', 'chapter-summary')
    `).run(defaultProjectId)
  }
}
