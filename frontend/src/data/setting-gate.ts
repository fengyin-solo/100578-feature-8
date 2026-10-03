import { findRange, latestVersion } from '@/data/setting-ranges'

// 上下限闸门：提交复核前拿整定值与装置铭牌范围比一遍，边界值算合格。

export type GateVerdict = 'pending' | 'pass' | 'below' | 'over' | 'badvalue' | 'norange'

export type GateResult = {
  verdict: GateVerdict
  message: string
  rangeVersion: number
  lower?: number
  upper?: number
  unit?: string
}

// 整定值允许带单位（如 2800A、0.9s），比较时只取数字部分。
export function parseSettingValue(raw: string): number | null {
  const text = String(raw ?? '').trim()
  if (text === '') {
    return null
  }
  const matched = text.match(/-?\d+(\.\d+)?/)
  if (!matched) {
    return null
  }
  const value = Number(matched[0])
  return Number.isFinite(value) ? value : null
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
}

export function emptyGate(): GateResult {
  return { verdict: 'pending', message: '', rangeVersion: 0 }
}

export function evaluateGate(deviceRaw: string, itemRaw: string, valueRaw: string): GateResult {
  const device = String(deviceRaw ?? '').trim()
  const item = String(itemRaw ?? '').trim()
  const value = parseSettingValue(valueRaw)
  if (value === null) {
    return { verdict: 'badvalue', message: '整定值未填写或不是数字，无法与范围比较', rangeVersion: 0 }
  }
  const range = findRange(device, item)
  if (!range) {
    return { verdict: 'norange', message: `装置「${device}」的「${item}」尚未定义铭牌范围，先到范围维护登记上下限`, rangeVersion: 0 }
  }
  const version = latestVersion(device)
  if (value < range.lower) {
    const gap = formatNumber(range.lower - value)
    return {
      verdict: 'below',
      message: `低于下限：整定值 ${formatNumber(value)}${range.unit} 低于下限 ${formatNumber(range.lower)}${range.unit}，差 ${gap}${range.unit}，请退回重填`,
      rangeVersion: version,
      lower: range.lower,
      upper: range.upper,
      unit: range.unit,
    }
  }
  if (value > range.upper) {
    const gap = formatNumber(value - range.upper)
    return {
      verdict: 'over',
      message: `高出上限：整定值 ${formatNumber(value)}${range.unit} 高出上限 ${formatNumber(range.upper)}${range.unit}，差 ${gap}${range.unit}，请退回重填`,
      rangeVersion: version,
      lower: range.lower,
      upper: range.upper,
      unit: range.unit,
    }
  }
  return {
    verdict: 'pass',
    message: `在范围内：${formatNumber(range.lower)}～${formatNumber(range.upper)}${range.unit}，当前 ${formatNumber(value)}${range.unit}（压边界按合格）`,
    rangeVersion: version,
    lower: range.lower,
    upper: range.upper,
    unit: range.unit,
  }
}
