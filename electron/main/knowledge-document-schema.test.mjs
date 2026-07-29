import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { migrateKnowledgeDocumentScopes } from './knowledge-document-schema.ts'

test('旧知识文档迁移为全局参考资料和项目级知识', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, selected_project_id TEXT NOT NULL);
    CREATE TABLE knowledge_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL
    );
    INSERT INTO projects (id) VALUES ('project-a'), ('project-b');
    INSERT INTO app_settings (id, selected_project_id) VALUES (1, 'project-b');
    INSERT INTO knowledge_documents (id, project_id, source_type) VALUES
      ('reference', 'project-a', 'reference-summary'),
      ('legacy-project', '', 'canon-fact'),
      ('owned-project', 'project-a', 'chapter-summary');
  `)

  migrateKnowledgeDocumentScopes(db)

  const rows = db.prepare(`
    SELECT id, project_id AS projectId
    FROM knowledge_documents
    ORDER BY id ASC
  `).all().map((row) => ({ id: row.id, projectId: row.projectId }))
  assert.deepEqual(rows, [
    { id: 'legacy-project', projectId: 'project-b' },
    { id: 'owned-project', projectId: 'project-a' },
    { id: 'reference', projectId: '' }
  ])
  db.close()
})
