import type { EntryRow } from './types'

// 装置铭牌整定范围的独立存储：同一台装置下多张定值单共用一份，调整即升版。
const RANGE_STORAGE_KEY = 'substation-protection:setting-ranges'

export type SettingRange = {
  device: string
  item: string
  lower: number
  upper: number
  unit: string
  updatedAt: string
}

export type RangeStoreData = {
  ranges: SettingRange[]
  versions: Record<string, number>
}

// 示例范围：按「装置 + 保护类别」给上下限，单位跟整定值保持一致。
export const SEED_SETTING_RANGES: SettingRange[] = [
  { device: 'PCS-941（110kV东线保护）', item: '电流速断保护', lower: 2400, upper: 3000, unit: 'A', updatedAt: '2026-09-10' },
  { device: 'PCS-941（110kV东线保护）', item: '限时电流速断保护', lower: 1200, upper: 1800, unit: 'A', updatedAt: '2026-09-10' },
  { device: 'PCS-941（110kV东线保护）', item: '过电流保护', lower: 600, upper: 900, unit: 'A', updatedAt: '2026-09-10' },
  { device: 'PCS-941（110kV东线保护）', item: '零序过流保护', lower: 60, upper: 120, unit: 'A', updatedAt: '2026-09-10' },
  { device: 'PCS-941（110kV东线保护）', item: '重合闸时间', lower: 0.8, upper: 1.5, unit: 's', updatedAt: '2026-09-10' },
  { device: 'CSC-211（10kV馈线F06保护）', item: '电流速断保护', lower: 3000, upper: 4000, unit: 'A', updatedAt: '2026-09-10' },
  { device: 'CSC-211（10kV馈线F06保护）', item: '过电流保护', lower: 500, upper: 800, unit: 'A', updatedAt: '2026-09-10' },
  { device: 'CSC-211（10kV馈线F06保护）', item: '零序过流保护', lower: 30, upper: 60, unit: 'A', updatedAt: '2026-09-10' },
  { device: 'PCS-978（1号主变差动保护）', item: '差动保护启动电流', lower: 0.3, upper: 0.5, unit: 'Ie', updatedAt: '2026-09-10' },
  { device: 'PCS-978（1号主变差动保护）', item: '比率制动系数', lower: 0.3, upper: 0.7, unit: '', updatedAt: '2026-09-10' },
  { device: 'PCS-978（1号主变差动保护）', item: '高压侧复压过流', lower: 600, upper: 900, unit: 'A', updatedAt: '2026-09-10' },
  { device: 'PCS-978（1号主变差动保护）', item: '过负荷告警', lower: 400, upper: 600, unit: 'A', updatedAt: '2026-09-10' },
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedData(): RangeStoreData {
  const versions: Record<string, number> = {}
  for (const range of SEED_SETTING_RANGES) {
    versions[range.device] = 1
  }
  return { ranges: clone(SEED_SETTING_RANGES), versions }
}

function readStorage(): RangeStoreData {
  const fallback = seedData()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(RANGE_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RangeStoreData>
    return {
      ranges: Array.isArray(parsed.ranges) ? parsed.ranges : fallback.ranges,
      versions: parsed.versions && typeof parsed.versions === 'object' ? parsed.versions : fallback.versions,
    }
  } catch {
    window.localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: RangeStoreData | null = null

function store(): RangeStoreData {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(store()))
  }
}

export function todayLabel(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function listRanges(): SettingRange[] {
  return store().ranges
}

export function listDevices(): string[] {
  const devices = new Set<string>()
  for (const range of store().ranges) {
    devices.add(range.device)
  }
  return [...devices]
}

export function listItems(device: string): string[] {
  const items = new Set<string>()
  for (const range of store().ranges) {
    if (range.device === device) {
      items.add(range.item)
    }
  }
  return [...items]
}

export function findRange(device: string, item: string): SettingRange | undefined {
  return store().ranges.find((range) => range.device === device && range.item === item)
}

// 当前装置范围的最新版本号：任何一条上下限调整都会让该装置升一版。
export function latestVersion(device: string): number {
  return store().versions[device] ?? 0
}

function bumpVersion(device: string): number {
  const next = (store().versions[device] ?? 0) + 1
  store().versions[device] = next
  return next
}

export type RangeInput = {
  device: string
  item: string
  lower: number
  upper: number
  unit: string
}

// 新增或覆盖一条范围；同一装置下的调整会升版，之后所有比对都按新版走。
export function saveRange(input: RangeInput, original?: { device: string; item: string }): void {
  const data = store()
  if (original && (original.device !== input.device || original.item !== input.item)) {
    data.ranges = data.ranges.filter(
      (range) => !(range.device === original.device && range.item === original.item),
    )
    if (original.device !== input.device) {
      bumpVersion(original.device)
    }
  }
  const index = data.ranges.findIndex(
    (range) => range.device === input.device && range.item === input.item,
  )
  const next: SettingRange = { ...input, updatedAt: todayLabel() }
  if (index >= 0) {
    data.ranges[index] = next
  } else {
    data.ranges.push(next)
  }
  bumpVersion(input.device)
  persist()
}

export function removeRange(device: string, item: string): void {
  const data = store()
  data.ranges = data.ranges.filter((range) => !(range.device === device && range.item === item))
  bumpVersion(device)
  persist()
}

export function resetRanges(): SettingRange[] {
  cache = seedData()
  persist()
  return cache.ranges
}

// 已登记定值单上出现过、但范围表里还没有的装置，也一并暴露给选择框。
export function devicesFromRows(rows: EntryRow[]): string[] {
  const devices = new Set(listDevices())
  for (const row of rows) {
    const device = String(row['所属装置'] ?? '').trim()
    if (device) {
      devices.add(device)
    }
  }
  return [...devices]
}
