import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  applyStateDelta,
  initStoryStateSchema,
  normalizeStateDelta
} from './story-state-store.ts'

test('畸形状态增量会被规范化为可遍历、可绑定的字段', () => {
  const delta = normalizeStateDelta({
    characters_updated: [{
      character_id: '林岚',
      changes: {
        mental_state: { value: '紧张' },
        arc_progression: ['第一阶段'],
        new_knowledge: ['密道', '密道', { value: '无效' }]
      }
    }],
    foreshadowing_delta: {
      planted: null,
      advanced: { id: '伏笔-1', clue: '旧信出现', method: '侧写' },
      resolved: '无'
    },
    timeline: { events: '抵达城门' }
  })

  assert.deepEqual(delta.foreshadowing_delta.advanced, [{ id: '伏笔-1', clue: '旧信出现', method: '侧写' }])
  assert.equal(delta.characters_updated[0].changes.mental_state, undefined)
  assert.deepEqual(delta.characters_updated[0].changes.new_knowledge, ['密道'])
  assert.deepEqual(delta.timeline.events, [])
})

test('同一章节状态增量重复写入不会重复累积数组字段', () => {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  const delta = normalizeStateDelta({
    characters_updated: [{
      character_id: '林岚',
      changes: {
        mental_state: '警觉',
        inventory_delta: { added: ['旧信'], removed: [] },
        new_knowledge: ['密道入口'],
        goals_update: { completed: [], added: ['找到证人'] }
      }
    }],
    relationships_delta: [{
      relationship_id: '林岚-顾川',
      participants: ['林岚', '顾川'],
      status_change: { from: '陌生', to: '合作', pivot_event: '共同脱险' },
      new_tension_points: ['互不信任']
    }],
    foreshadowing_delta: {
      planted: [{ id: '伏笔-1', type: '暗线', description: '旧信', method: '道具', payoff_chapter: 20 }],
      advanced: [{ id: '伏笔-1', clue: '火漆印', method: '特写' }],
      resolved: []
    },
    timeline: { current_story_date: '第三日', events: ['离城'] }
  })

  applyStateDelta(db, 'project-1', 3, delta)
  applyStateDelta(db, 'project-1', 3, delta)

  const character = db.prepare('SELECT knowledge_json, inventory_json, goals_json FROM story_character_state').get()
  const relationship = db.prepare('SELECT tension_points_json FROM story_relationships').get()
  const foreshadowing = db.prepare('SELECT clues_json FROM story_foreshadowing').get()
  assert.deepEqual(JSON.parse(character.knowledge_json), ['密道入口'])
  assert.deepEqual(JSON.parse(character.inventory_json), ['旧信'])
  assert.deepEqual(JSON.parse(character.goals_json), ['找到证人'])
  assert.deepEqual(JSON.parse(relationship.tension_points_json), ['互不信任'])
  assert.deepEqual(JSON.parse(foreshadowing.clues_json), [{ chapter: 3, clue: '火漆印', method: '特写' }])
})
