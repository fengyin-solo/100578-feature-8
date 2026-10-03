import { useSessionStore } from '@/stores/session'
import { evaluateGate, emptyGate, formatNumber, type GateResult } from '@/data/setting-gate'
import { latestVersion } from '@/data/setting-ranges'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 定值整定专用流转：闸门判定 → 整定人确认送复核 → 专责复核 → 推进待送审。
const SETTING_KEY = 'settingvalue'
const APPROVE_KEY = 'settingapprove'

// 提交前必须写全的格子：单号、项目、计算依据按要求点出，装置和整定值是比较范围的前提。
export const REQUIRED_FIELDS = ['定值单号', '所属装置', '定值项目', '整定值', '计算依据']

const EDITABLE_STATUSES = ['待整定', '整定中']
const VOID_STATUS = '已作废'

export type SettingDraft = {
  定值单号: string
  所属装置: string
  定值项目: string
  整定值: string
  计算依据: string
  整定人: string
}

export type SubmitResult = {
  ok: boolean
  message: string
  missing: string[]
  gate: GateResult
}

export function missingFields(row: Partial<EntryRow> | SettingDraft): string[] {
  const record = row as Record<string, unknown>
  return REQUIRED_FIELDS.filter((field) => String(record[field] ?? '').trim() === '')
}

export function nextSettingId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextApproveId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function gateOf(row: EntryRow): GateResult {
  const payload = row['闸门结论']
  if (typeof payload === 'string' && payload.trim() !== '') {
    try {
      const parsed = JSON.parse(payload) as Partial<GateResult>
      if (parsed && typeof parsed.verdict === 'string' && typeof parsed.message === 'string') {
        return {
          verdict: parsed.verdict as GateResult['verdict'],
          message: parsed.message,
          rangeVersion: Number(parsed.rangeVersion ?? 0),
          lower: parsed.lower,
          upper: parsed.upper,
          unit: typeof parsed.unit === 'string' ? parsed.unit : '',
        }
      }
    } catch {
      // 旧数据没有闸门结论时按空白处理。
    }
  }
  return emptyGate()
}

export function rowGate(row: EntryRow): GateResult {
  const gate = gateOf(row)
  if (gate.verdict === 'pending') {
    return evaluateGate(String(row['所属装置'] ?? ''), String(row['定值项目'] ?? ''), String(row['整定值'] ?? ''))
  }
  return gate
}

// 复核/查看时始终拿最新一版范围再比一次，避免送复核后范围改了版本。
export function liveGate(row: EntryRow): GateResult {
  return evaluateGate(String(row['所属装置'] ?? ''), String(row['定值项目'] ?? ''), String(row['整定值'] ?? ''))
}

export function isStaleGate(row: EntryRow): boolean {
  const gate = gateOf(row)
  const device = String(row['所属装置'] ?? '')
  return gate.verdict !== 'pending' && latestVersion(device) > gate.rangeVersion
}

function buildRow(id: number, draft: SettingDraft, status: string): EntryRow {
  return {
    id,
    status,
    pending: status !== VOID_STATUS,
    abnormal: false,
    定值单号: draft.定值单号.trim(),
    所属装置: draft.所属装置.trim(),
    定值项目: draft.定值项目.trim(),
    整定值: draft.整定值.trim(),
    计算依据: draft.计算依据.trim(),
    整定人: draft.整定人.trim(),
    审核人: '',
    复核时间: '',
    范围版本: 0,
    闸门结论: '',
  }
}

export type CreateResult = {
  ok: boolean
  message: string
  id?: number
  missing: string[]
}

// 登记新定值单：单号必填且全台账唯一；其余缺项允许先落单为「待整定」，提交前再点出来。
export function createSetting(draft: SettingDraft): CreateResult {
  const rows = listRows(SETTING_KEY)
  const orderNo = draft.定值单号.trim()
  if (orderNo === '') {
    return { ok: false, message: '定值单号是必填格，请先补全', missing: ['定值单号'] }
  }
  if (rows.some((row) => String(row['定值单号'] ?? '') === orderNo)) {
    return { ok: false, message: `定值单号 ${orderNo} 已存在，不能重复登记`, missing: [] }
  }
  const missing = missingFields(draft)
  const id = nextSettingId(rows)
  const row = buildRow(id, draft, missing.length > 0 ? '待整定' : '整定中')
  saveRows(SETTING_KEY, [...rows, row])
  return {
    ok: true,
    id,
    missing,
    message:
      missing.length > 0
        ? `定值单 ${orderNo} 已登记为「待整定」，还差：${missing.join('、')}`
        : `定值单 ${orderNo} 已登记，可填写整定后确认送复核`,
  }
}

export type SaveResult = {
  ok: boolean
  message: string
  missing: string[]
  gate: GateResult
}

// 保存整定内容：缺哪格在行内点出，先存下来给整定人改；闸门结论按最新范围同步刷新。
export function saveSettingDraft(id: number, draft: SettingDraft): SaveResult {
  const rows = listRows(SETTING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这张定值单', missing: [], gate: emptyGate() }
  }
  const current = rows[index]
  if (current.status === VOID_STATUS) {
    return { ok: false, message: '定值单已作废，不能再修改', missing: [], gate: emptyGate() }
  }
  const missing = missingFields(draft)
  const gate =
    missing.length === 0
      ? evaluateGate(draft.所属装置, draft.定值项目, draft.整定值)
      : emptyGate()
  const status = EDITABLE_STATUSES.includes(String(current.status))
    ? missing.length > 0
      ? '待整定'
      : '整定中'
    : String(current.status)
  const updated: EntryRow = {
    ...buildRow(id, draft, status),
    审核人: String(current['审核人'] ?? ''),
    复核时间: String(current['复核时间'] ?? ''),
    范围版本: Number(current['范围版本'] ?? 0),
    闸门结论: gate.verdict === 'pending' ? '' : JSON.stringify(gate),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(SETTING_KEY, next)
  return {
    ok: true,
    missing,
    gate,
    message:
      missing.length > 0
        ? `已保存，还差：${missing.join('、')}`
        : gate.verdict === 'pass'
          ? '已保存，整定值在铭牌范围内，可确认送复核'
          : `已保存，${gate.message}`,
  }
}

// 整定人确认后交专责复核：缺项、非数字、无范围、越限一律退回重填，不产生流转。
export function submitSetting(id: number): SubmitResult {
  const rows = listRows(SETTING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这张定值单', missing: [], gate: emptyGate() }
  }
  const current = rows[index]
  if (current.status === VOID_STATUS) {
    return { ok: false, message: '定值单已作废，不能送复核', missing: [], gate: emptyGate() }
  }
  if (current.status === '已复核') {
    return { ok: false, message: '定值单已复核通过并进入待送审，不能重复送复核', missing: [], gate: emptyGate() }
  }
  const draft: SettingDraft = {
    定值单号: String(current['定值单号'] ?? ''),
    所属装置: String(current['所属装置'] ?? ''),
    定值项目: String(current['定值项目'] ?? ''),
    整定值: String(current['整定值'] ?? ''),
    计算依据: String(current['计算依据'] ?? ''),
    整定人: String(current['整定人'] ?? ''),
  }
  const missing = missingFields(draft)
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      gate: emptyGate(),
      message: `退回重填：定值单上缺 ${missing.join('、')}`,
    }
  }
  const gate = evaluateGate(draft.所属装置, draft.定值项目, draft.整定值)
  if (gate.verdict !== 'pass') {
    const updated: EntryRow = {
      ...current,
      status: '整定中',
      pending: true,
      abnormal: false,
      闸门结论: JSON.stringify(gate),
    }
    const next = [...rows]
    next[index] = updated
    saveRows(SETTING_KEY, next)
    return {
      ok: false,
      missing: [],
      gate,
      message: `退回重填：${gate.message}`,
    }
  }
  const updated: EntryRow = {
    ...current,
    status: '待复核',
    pending: true,
    abnormal: false,
    范围版本: gate.rangeVersion,
    闸门结论: JSON.stringify(gate),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(SETTING_KEY, next)
  return {
    ok: true,
    missing: [],
    gate,
    message: `整定值 ${draft.整定值} 在范围内（${formatNumber(gate.lower ?? 0)}～${formatNumber(gate.upper ?? 0)}${gate.unit ?? ''}），已交专责复核`,
  }
}

// 专责复核：始终按最新一版范围再比一次，过了才往后走，并推进待送审清单。
export function reviewSetting(id: number): ActionResult {
  const session = useSessionStore()
  const rows = listRows(SETTING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这张定值单' }
  }
  const current = rows[index]
  if (current.status !== '待复核') {
    return { ok: false, message: '只有待复核的定值单才能执行专责复核' }
  }
  const gate = evaluateGate(
    String(current['所属装置'] ?? ''),
    String(current['定值项目'] ?? ''),
    String(current['整定值'] ?? ''),
  )
  if (gate.verdict !== 'pass') {
    return { ok: false, message: `复核未通过：${gate.message}` }
  }
  const reviewer = session.operator || '专责'
  const updated: EntryRow = {
    ...current,
    status: '已复核',
    pending: false,
    abnormal: false,
    审核人: reviewer,
    复核时间: new Date().toISOString().slice(0, 10),
    范围版本: gate.rangeVersion,
    闸门结论: JSON.stringify(gate),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(SETTING_KEY, next)
  pushApproveList(updated)
  return { ok: true, message: `定值单 ${updated['定值单号']} 复核通过，已推进到定值审批待送审清单` }
}

// 复核不通过：退回整定人重填，下一次确认仍要过闸门。
export function returnSetting(id: number): ActionResult {
  const rows = listRows(SETTING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这张定值单' }
  }
  const current = rows[index]
  if (current.status !== '待复核') {
    return { ok: false, message: '只有待复核的定值单才能退回' }
  }
  const updated: EntryRow = {
    ...current,
    status: '整定中',
    pending: true,
    abnormal: false,
    范围版本: 0,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(SETTING_KEY, next)
  return { ok: true, message: `定值单 ${updated['定值单号']} 已退回整定人重填` }
}

export function voidSetting(id: number): ActionResult {
  const rows = listRows(SETTING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这张定值单' }
  }
  if (rows[index].status === VOID_STATUS) {
    return { ok: false, message: '定值单已经是「已作废」，不用重复操作' }
  }
  const updated: EntryRow = { ...rows[index], status: VOID_STATUS, pending: false, abnormal: true }
  const next = [...rows]
  next[index] = updated
  saveRows(SETTING_KEY, next)
  return { ok: true, message: `定值单 ${updated['定值单号']} 已作废` }
}

// 同一张定值单反复送复核只维护一条待送审记录：按关联定值单唯一。
function pushApproveList(setting: EntryRow): ActionResult {
  const rows = listRows(APPROVE_KEY)
  const orderNo = String(setting['定值单号'] ?? '')
  const index = rows.findIndex((row) => String(row['关联定值单'] ?? '') === orderNo)
  const today = new Date().toISOString().slice(0, 10)
  const base: Record<string, string> = {
    审批单号: `APV-${orderNo}`,
    关联定值单: orderNo,
    审批层级: '专责复核通过',
    送审人: String(setting['审核人'] ?? ''),
    审批人: '',
    送审日期: today,
    审批意见: '整定范围复核通过，待送审',
    审批状态: '待送审',
  }
  if (index >= 0) {
    const existing = rows[index]
    const updated: EntryRow = {
      ...existing,
      ...base,
      status: '待送审',
      pending: true,
      abnormal: false,
    }
    const next = [...rows]
    next[index] = updated
    saveRows(APPROVE_KEY, next)
    return { ok: true, message: '待送审记录已更新，未新增条目' }
  }
  const row: EntryRow = {
    id: nextApproveId(rows),
    status: '待送审',
    pending: true,
    abnormal: false,
    ...base,
  }
  saveRows(APPROVE_KEY, [...rows, row])
  return { ok: true, message: '已写入待送审清单' }
}
