import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 定值整定专用服务：范围按「装置 + 保护类别」分版本维护，闸门永远比最新版本；
// 整定确认、专责复核、退回重填、送审联动都走这里，不再用通用 runAction。

const SETTING_KEY = 'settingvalue'
const RANGE_KEY = 'settingrange'
const DEVICE_KEY = 'protectiondevice'
const APPROVE_KEY = 'settingapprove'

// 提交前必填的格子：缺哪一格就在行内那一点出来。
const REQUIRED_FIELDS = ['定值单号', '所属装置', '保护类别', '定值项目', '整定值', '计算依据'] as const

export type GateSide = '上限' | '下限'

export type FieldIssue = {
  field: string
  message: string
}

export type GateVerdict = {
  ok: boolean
  message: string
  fieldIssues: FieldIssue[]
  // 命中范围时带回，页面好展示区间与版本；越限时带上越的是哪一侧、差多少。
  rangeRow?: EntryRow
  side?: GateSide
  delta?: number
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function todayLabel(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseSettingValue(raw: string): number | null {
  // 整定值只取数字主体，单位在单独的格子里：12.5A、1.2 s 都认。
  const matched = raw.match(/-?\d+(?:\.\d+)?/)
  if (!matched) {
    return null
  }
  const value = Number(matched[0])
  return Number.isFinite(value) ? value : null
}

function sameMagnitude(a: number, b: number): boolean {
  // 正好压在边界上算合格，给一点浮点容差。
  return Math.abs(a - b) < 1e-9
}

export function listRanges(device = '', includeArchived = false): EntryRow[] {
  const rows = listRows(RANGE_KEY).filter((row) => {
    if (!includeArchived && text(row, '状态') === '已归档') {
      return false
    }
    return device === '' || text(row, '所属装置') === device
  })
  return rows.sort((a, b) => Number(b.版本) - Number(a.版本))
}

export function listRangeDevices(): EntryRow[] {
  return listRows(RANGE_KEY).sort((a, b) =>
    text(a, '所属装置').localeCompare(text(b, '所属装置'), 'zh-Hans-CN'),
  )
}

export function listDeviceOptions(): EntryRow[] {
  return listRows(DEVICE_KEY).sort((a, b) =>
    text(a, '装置编号').localeCompare(text(b, '装置编号'), 'zh-Hans-CN'),
  )
}

export function listCategories(device = ''): string[] {
  const names = listRanges(device)
    .map((row) => text(row, '保护类别'))
    .filter((name) => name !== '')
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

// 同一台装置下多张单子共用这一份范围；调整后只认版本号最大的现行版。
export function latestRange(device: string, category: string): EntryRow | undefined {
  return listRanges(device)
    .filter(
      (row) => text(row, '保护类别') === category.trim() && text(row, '状态') !== '已归档',
    )
    .sort((a, b) => Number(b.版本) - Number(a.版本))[0]
}

// 行内改装置 / 类别后，把最新版范围的单位带出来。
export function deviceUnitFor(device: string, category: string): string {
  const range = latestRange(device, category)
  return range ? text(range, '单位') : ''
}

// 拿整定值与最新一版范围比一遍：缺格、无范围、高出上限、低于下限都在这说清楚。
export function evaluateSheet(row: EntryRow): GateVerdict {
  const fieldIssues: FieldIssue[] = []

  for (const field of REQUIRED_FIELDS) {
    if (text(row, field) === '') {
      fieldIssues.push({ field, message: `${field}未填写` })
    }
  }

  const rawValue = text(row, '整定值')
  const numeric = rawValue === '' ? null : parseSettingValue(rawValue)
  if (rawValue !== '' && numeric === null) {
    fieldIssues.push({ field: '整定值', message: `整定值「${rawValue}」不是有效数字` })
  }

  const device = text(row, '所属装置')
  const category = text(row, '保护类别')
  const range = device !== '' && category !== '' ? latestRange(device, category) : undefined

  if (!fieldIssues.some((issue) => ['所属装置', '保护类别'].includes(issue.field)) && !range) {
    fieldIssues.push({
      field: '保护类别',
      message: `装置 ${device || '（未填）'} 还没有「${category || '（未填）'}」的整定范围，请先维护上下限`,
    })
  }

  if (numeric === null || !range) {
    return {
      ok: false,
      message: fieldIssues.map((issue) => issue.message).join('；') || '闸门校验未通过',
      fieldIssues,
      rangeRow: range,
    }
  }

  const upper = Number(text(range, '上限'))
  const lower = Number(text(range, '下限'))
  const unit = text(range, '单位')
  const suffix = unit ? ` ${unit}` : ''
  const version = `v${text(range, '版本')}`
  const base = `整定值 ${numeric}${suffix}，范围 ${lower}～${upper}${suffix}（${version}）`

  if (numeric > upper && !sameMagnitude(numeric, upper)) {
    const delta = Number((numeric - upper).toFixed(6))
    return {
      ok: false,
      rangeRow: range,
      side: '上限',
      delta,
      message: `${base}：高过上限 ${delta}${suffix}，请退回重填`,
      fieldIssues: [
        ...fieldIssues,
        { field: '整定值', message: `越上限：高过 ${upper}${suffix}，差 ${delta}${suffix}` },
      ],
    }
  }

  if (numeric < lower && !sameMagnitude(numeric, lower)) {
    const delta = Number((lower - numeric).toFixed(6))
    return {
      ok: false,
      rangeRow: range,
      side: '下限',
      delta,
      message: `${base}：低于下限 ${delta}${suffix}，请退回重填`,
      fieldIssues: [
        ...fieldIssues,
        { field: '整定值', message: `越下限：低于 ${lower}${suffix}，差 ${delta}${suffix}` },
      ],
    }
  }

  return {
    ok: true,
    rangeRow: range,
    message: `${base}：落在范围内，闸门通过`,
    fieldIssues,
  }
}

export function listSettings(): EntryRow[] {
  return listRows(SETTING_KEY).sort((a, b) => Number(b.id) - Number(a.id))
}

function saveSettings(rows: EntryRow[]): void {
  saveRows(SETTING_KEY, rows)
}

function findSetting(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === id)
}

function nextSheetNo(rows: EntryRow[]): string {
  const year = new Date().getFullYear()
  let max = 0
  for (const row of rows) {
    const matched = text(row, '定值单号').match(/(\d+)$/)
    if (matched) {
      max = Math.max(max, Number(matched[1]))
    }
  }
  return `SETT-${year}-${String(max + 1).padStart(4, '0')}`
}

export function createSetting(input: {
  device: string
  category: string
  project: string
  value: string
  unit: string
  basis: string
  operator: string
}): ActionResult & { id?: number } {
  const rows = listSettings()
  const draft: EntryRow = {
    id: 0,
    status: '待整定',
    pending: true,
    abnormal: false,
    定值单号: nextSheetNo(rows),
    所属装置: input.device.trim(),
    保护类别: input.category.trim(),
    定值项目: input.project.trim(),
    整定值: input.value.trim(),
    单位: input.unit.trim(),
    计算依据: input.basis.trim(),
    整定人: input.operator.trim(),
    复核人: '',
    复核时间: '',
    适用版本: '',
    关联审批单: '',
    退回原因: '',
  }
  const verdict = evaluateSheet(draft)
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  rows.push({ ...draft, id })
  saveSettings(rows)
  return {
    ok: true,
    id,
    message: verdict.ok
      ? `定值单 ${draft.定值单号} 已登记，闸门校验通过`
      : `定值单 ${draft.定值单号} 已登记为待整定：${verdict.message}`,
  }
}

export function updateSettingCell(id: number, field: string, value: string): ActionResult {
  const rows = listSettings()
  const current = findSetting(rows, id)
  if (!current) {
    return { ok: false, message: `没有找到编号为 ${id} 的定值单` }
  }
  if (current.status === '已复核') {
    return { ok: false, message: '已复核的定值单不能再改，需要调整请先作废或走审批退回' }
  }
  const next = [...rows]
  next[rows.indexOf(current)] = {
    ...current,
    [field]: value,
    abnormal: false,
    退回原因: '',
  }
  saveSettings(next)
  return { ok: true, message: '已保存' }
}

function onlyStatus(row: EntryRow | undefined, allowed: string[]): ActionResult | null {
  if (!row) {
    return { ok: false, message: '没有找到这张定值单' }
  }
  if (!allowed.includes(String(row.status))) {
    return { ok: false, message: `定值单当前是「${row.status}」，不能做这个操作` }
  }
  return null
}

// 整定人确认：拿最新一版范围比，不通过就退回重填，问题落在行内格子上。
export function confirmSetting(id: number): ActionResult {
  const rows = listSettings()
  const current = findSetting(rows, id)
  const blocked = onlyStatus(current, ['待整定', '退回重填'])
  if (blocked || !current) {
    return blocked ?? { ok: false, message: '没有找到这张定值单' }
  }
  const verdict = evaluateSheet(current)
  if (!verdict.ok) {
    const next = [...rows]
    next[rows.indexOf(current)] = {
      ...current,
      status: '退回重填',
      pending: true,
      abnormal: true,
      退回原因: verdict.message,
      适用版本: verdict.rangeRow ? `v${text(verdict.rangeRow, '版本')}` : '',
    }
    saveSettings(next)
    return { ok: false, message: `闸门未通过，已退回重填：${verdict.message}` }
  }

  const range = verdict.rangeRow as EntryRow
  const next = [...rows]
  next[rows.indexOf(current)] = {
    ...current,
    status: '待复核',
    pending: true,
    abnormal: false,
    单位: text(current, '单位') || text(range, '单位'),
    适用版本: `v${text(range, '版本')}`,
    退回原因: '',
  }
  saveSettings(next)
  return { ok: true, message: `定值单 ${text(current, '定值单号')} 闸门通过，已交专责复核` }
}

function nextApproveNo(rows: EntryRow[]): string {
  let max = 0
  for (const row of rows) {
    const matched = text(row, '审批单号').match(/(\d+)$/)
    if (matched) {
      max = Math.max(max, Number(matched[1]))
    }
  }
  return `APPR-${String(max + 1).padStart(4, '0')}`
}

// 复核通过后推进到定值审批的待送审清单；同一张单子反复送复核不会多出一条。
function pushToApproveQueue(row: EntryRow, reviewer: string): string {
  const rows = listRows(APPROVE_KEY)
  const sheetNo = text(row, '定值单号')
  const existing = rows.find((item) => text(item, '关联定值单') === sheetNo)
  if (existing) {
    const index = rows.indexOf(existing)
    const approveNo = text(existing, '审批单号')
    rows[index] = {
      ...existing,
      status: '待送审',
      pending: true,
      abnormal: false,
      审批层级: text(existing, '审批层级') || '专责复核后待送审',
      送审人: reviewer,
      送审日期: todayLabel(),
      审批意见: '专责复核通过，待送审',
    }
    saveRows(APPROVE_KEY, rows)
    return approveNo
  }

  const approveNo = nextApproveNo(rows)
  rows.push({
    id: rows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1,
    status: '待送审',
    pending: true,
    abnormal: false,
    审批单号: approveNo,
    关联定值单: sheetNo,
    审批层级: '专责复核后待送审',
    送审人: reviewer,
    审批人: '',
    送审日期: todayLabel(),
    审批意见: '专责复核通过，待送审',
  })
  saveRows(APPROVE_KEY, rows)
  return approveNo
}

export function reviewSetting(id: number, reviewer: string): ActionResult {
  const name = reviewer.trim()
  if (!name) {
    return { ok: false, message: '请填写专责复核人' }
  }
  const rows = listSettings()
  const current = findSetting(rows, id)
  const blocked = onlyStatus(current, ['待复核'])
  if (blocked || !current) {
    return blocked ?? { ok: false, message: '没有找到这张定值单' }
  }
  // 复核时范围可能刚调整过，按最新一版再比一遍。
  const verdict = evaluateSheet(current)
  if (!verdict.ok) {
    const next = [...rows]
    next[rows.indexOf(current)] = {
      ...current,
      status: '退回重填',
      pending: true,
      abnormal: true,
      退回原因: `专责复核时按最新范围判定：${verdict.message}`,
      适用版本: verdict.rangeRow ? `v${text(verdict.rangeRow, '版本')}` : '',
    }
    saveSettings(next)
    return { ok: false, message: `复核未过，按最新范围退回重填：${verdict.message}` }
  }

  const range = verdict.rangeRow as EntryRow
  const approveNo = pushToApproveQueue(current, name)
  const next = [...rows]
  next[rows.indexOf(current)] = {
    ...current,
    status: '已复核',
    pending: false,
    abnormal: false,
    复核人: name,
    复核时间: todayLabel(),
    适用版本: `v${text(range, '版本')}`,
    单位: text(current, '单位') || text(range, '单位'),
    关联审批单: approveNo,
    退回原因: '',
  }
  saveSettings(next)
  return { ok: true, message: `复核通过：${approveNo} 已进入定值审批待送审清单` }
}

export function invalidateSetting(id: number): ActionResult {
  const rows = listSettings()
  const current = findSetting(rows, id)
  if (!current) {
    return { ok: false, message: '没有找到这张定值单' }
  }
  if (current.status === '已作废') {
    return { ok: false, message: '定值单已经是「已作废」' }
  }
  const next = [...rows]
  next[rows.indexOf(current)] = {
    ...current,
    status: '已作废',
    pending: false,
    abnormal: true,
  }
  saveSettings(next)
  return { ok: true, message: `定值单 ${text(current, '定值单号')} 已作废` }
}

function nextRangeId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

function nextRangeNo(rows: EntryRow[]): string {
  let max = 0
  for (const row of rows) {
    const matched = text(row, '范围编号').match(/(\d+)$/)
    if (matched) {
      max = Math.max(max, Number(matched[1]))
    }
  }
  return `RANG-${String(max + 1).padStart(4, '0')}`
}

type RangeBounds = { upper: number; lower: number }

function validateRangeBounds(upperText: string, lowerText: string): RangeBounds | ActionResult {
  const upper = Number(upperText)
  const lower = Number(lowerText)
  if (upperText.trim() === '' || !Number.isFinite(upper)) {
    return { ok: false, message: '上限必须是数字' }
  }
  if (lowerText.trim() === '' || !Number.isFinite(lower)) {
    return { ok: false, message: '下限必须是数字' }
  }
  if (lower > upper) {
    return { ok: false, message: `下限 ${lower} 不能高过上限 ${upper}` }
  }
  return { upper, lower }
}

function isBoundsFailure(value: RangeBounds | ActionResult): value is ActionResult {
  return 'ok' in value && value.ok === false
}

// 首次登记某装置某保护类别的范围：v1 现行。
export function createRange(input: {
  device: string
  category: string
  upper: string
  lower: string
  unit: string
}): ActionResult {
  const device = input.device.trim()
  const category = input.category.trim()
  if (!device || !category) {
    return { ok: false, message: '所属装置与保护类别都要填写' }
  }
  const bounds = validateRangeBounds(input.upper, input.lower)
  if (isBoundsFailure(bounds)) {
    return bounds
  }
  const { upper, lower } = bounds
  if (latestRange(device, category)) {
    return { ok: false, message: '该装置下这一保护类别已有范围，调整请用「调整范围」生成新版本' }
  }

  const rows = listRows(RANGE_KEY)
  rows.push({
    id: nextRangeId(rows),
    status: '现行',
    pending: true,
    abnormal: false,
    范围编号: nextRangeNo(rows),
    所属装置: device,
    保护类别: category,
    上限: upper,
    下限: lower,
    单位: input.unit.trim(),
    版本: 1,
    生效日期: todayLabel(),
  })
  saveRows(RANGE_KEY, rows)
  return { ok: true, message: `${device} 的「${category}」范围 v1 已设为现行` }
}

// 调整范围：旧版归档，新版版本号 +1；之后所有单子都按最新一版比。
export function adjustRange(input: {
  device: string
  category: string
  upper: string
  lower: string
  unit: string
}): ActionResult {
  const device = input.device.trim()
  const category = input.category.trim()
  const current = device && category ? latestRange(device, category) : undefined
  if (!current) {
    return createRange(input)
  }
  const bounds = validateRangeBounds(input.upper, input.lower)
  if (isBoundsFailure(bounds)) {
    return bounds
  }
  const { upper, lower } = bounds
  const rows = listRows(RANGE_KEY)
  const index = rows.indexOf(current)
  rows[index] = { ...current, status: '已归档', pending: false }
  rows.push({
    id: nextRangeId(rows),
    status: '现行',
    pending: true,
    abnormal: false,
    范围编号: nextRangeNo(rows),
    所属装置: device,
    保护类别: category,
    上限: upper,
    下限: lower,
    单位: input.unit.trim(),
    版本: Number(text(current, '版本')) + 1,
    生效日期: todayLabel(),
  })
  saveRows(RANGE_KEY, rows)
  return { ok: true, message: `${device} 的「${category}」已调整为 v${Number(text(current, '版本')) + 1}，旧版归档` }
}

export function rangeMeta() {
  const meta = MODULE_BY_KEY.get(RANGE_KEY)
  if (!meta) {
    throw new Error('缺少整定范围模块元数据')
  }
  return meta
}
