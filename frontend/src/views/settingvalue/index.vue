<template>
  <section class="page" data-module="settingvalue">
    <header class="page-head">
      <div>
        <h2>定值整定管理</h2>
        <p class="page-desc">每类保护按装置铭牌单独定义上下限，提交复核前过闸门：越限退回重填并在行内写明越侧与差值，边界值算合格；复核通过后进入定值审批待送审清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记定值单</button>
        <button class="btn" type="button" @click="openRanges">整定范围维护</button>
        <button class="btn" type="button" @click="exportRows">导出定值整定清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table setting-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>闸门判定</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-void': row.status === '已作废' }">
          <td v-for="column in columns" :key="column" :class="{ 'cell-missing': isMissing(row, column) }">
            <template v-if="isMissing(row, column)">
              <span class="tag-missing">缺{{ column }}</span>
            </template>
            <template v-else>
              {{ column === '范围版本' ? versionText(row) : (row[column] ?? '—') }}
            </template>
            <div v-if="column === '整定值'" class="cell-sub">
              <span v-if="isOverLimit(row)" class="verdict-fail">{{ valueGate(row).message }}</span>
            </div>
          </td>
          <td>
            <span :class="['verdict-chip', `verdict-${gateView(row).tone}`]">{{ gateView(row).text }}</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="rowActions(String(row.status)).length">
              <button
                v-for="action in rowActions(String(row.status))"
                :key="action"
                class="link"
                type="button"
                @click="handleAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-text">{{ row.status === '已复核' ? '已推进待送审' : '—' }}</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无定值整定数据，可先登记定值单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条定值单记录；范围按装置共享、调整即升版，比对永远取最新一版</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记 / 整定弹窗 -->
    <div v-if="formVisible" class="modal-overlay" @click.self="closeForm">
      <div class="modal">
        <header class="modal-head">
          <h3>{{ formMode === 'create' ? '登记定值单' : `整定定值单 ${form.定值单号 || ''}` }}</h3>
          <button class="link" type="button" @click="closeForm">关闭</button>
        </header>
        <div class="form-grid">
          <label class="form-field">
            <span>定值单号 <em class="req">*</em></span>
            <input v-model="form.定值单号" placeholder="如 SETT-20260913-03" :disabled="formMode === 'edit'" />
          </label>
          <label class="form-field">
            <span>所属装置 <em class="req">*</em></span>
            <input v-model="form.所属装置" list="setting-device-options" placeholder="选择或输入装置编号" />
            <datalist id="setting-device-options">
              <option v-for="device in deviceOptions" :key="device" :value="device" />
            </datalist>
          </label>
          <label class="form-field">
            <span>定值项目（保护类别） <em class="req">*</em></span>
            <input v-model="form.定值项目" list="setting-item-options" placeholder="选择或输入保护类别" />
            <datalist id="setting-item-options">
              <option v-for="item in itemOptions" :key="item" :value="item" />
            </datalist>
          </label>
          <label class="form-field">
            <span>整定值 <em class="req">*</em></span>
            <input v-model="form.整定值" placeholder="数字可带单位，如 2800A" />
          </label>
          <label class="form-field wide">
            <span>计算依据 <em class="req">*</em></span>
            <textarea v-model="form.计算依据" rows="2" placeholder="整定计算书名称、版本及整定原则"></textarea>
          </label>
          <label class="form-field">
            <span>整定人 <em class="req">*</em></span>
            <input v-model="form.整定人" />
          </label>
        </div>

        <div class="gate-panel">
          <p v-if="formMissing.length" class="verdict-fail">必填格未写全：{{ formMissing.join('、') }}</p>
          <p v-else-if="formGate.verdict === 'pass'" class="verdict-pass">{{ formGate.message }}</p>
          <p v-else-if="formGate.verdict === 'below' || formGate.verdict === 'over'" class="verdict-fail">{{ formGate.message }}</p>
          <p v-else-if="formGate.verdict === 'badvalue'" class="verdict-fail">整定值不是有效数字，请重填</p>
          <p v-else-if="formGate.verdict === 'norange'" class="verdict-warn">{{ formGate.message }}</p>
          <p v-else class="muted-text">写全装置、项目与整定值后，这里按最新版铭牌范围实时给出闸门判定</p>
        </div>

        <p v-if="formError" class="error-text form-error">{{ formError }}</p>

        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="closeForm">取消</button>
          <button v-if="formMode === 'create'" class="btn primary" type="button" @click="confirmCreate">登记定值单</button>
          <template v-else>
            <button class="btn" type="button" @click="confirmSave">暂存修改</button>
            <button class="btn primary" type="button" @click="confirmSubmit">整定人确认，送专责复核</button>
          </template>
        </footer>
      </div>
    </div>

    <!-- 整定范围维护弹窗 -->
    <div v-if="rangeVisible" class="modal-overlay wide" @click.self="closeRanges">
      <div class="modal">
        <header class="modal-head">
          <h3>整定范围维护（按装置 + 保护类别定义上下限）</h3>
          <button class="link" type="button" @click="closeRanges">关闭</button>
        </header>
        <div class="form-grid">
          <label class="form-field">
            <span>所属装置</span>
            <input v-model="rangeForm.device" list="range-device-options" placeholder="选择装置查看/新增范围" @change="onRangeDeviceChange" />
            <datalist id="range-device-options">
              <option v-for="device in deviceOptions" :key="device" :value="device" />
            </datalist>
          </label>
          <label class="form-field">
            <span>定值项目（保护类别）</span>
            <input v-model="rangeForm.item" list="range-item-options" placeholder="如 电流速断保护" />
            <datalist id="range-item-options">
              <option v-for="item in rangeItemOptions" :key="item" :value="item" />
            </datalist>
          </label>
          <label class="form-field">
            <span>下限</span>
            <input v-model="rangeForm.lower" placeholder="如 2400" />
          </label>
          <label class="form-field">
            <span>上限</span>
            <input v-model="rangeForm.upper" placeholder="如 3000" />
          </label>
          <label class="form-field">
            <span>单位</span>
            <input v-model="rangeForm.unit" placeholder="如 A / s / Ie，可留空" />
          </label>
        </div>
        <p v-if="rangeError" class="error-text form-error">{{ rangeError }}</p>
        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="resetRangeForm">清空重填</button>
          <button class="btn primary" type="button" @click="saveRangeForm">{{ rangeEditing ? '保存范围调整（升版）' : '新增范围（升版）' }}</button>
        </footer>

        <div class="range-list-head">
          <strong>{{ rangeForm.device ? `「${rangeForm.device}」的范围（当前第 v${deviceVersion} 版）` : '选择装置后展示其名下全部范围' }}</strong>
          <span class="muted-text">同装置多张定值单共用；任何调整都使该装置范围升版，已送未核的单子按新版重比</span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>定值项目</th><th>下限</th><th>上限</th><th>单位</th><th>最近更新</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="range in deviceRanges" :key="range.item">
              <td>{{ range.item }}</td>
              <td>{{ range.lower }}</td>
              <td>{{ range.upper }}</td>
              <td>{{ range.unit || '—' }}</td>
              <td>{{ range.updatedAt }}</td>
              <td class="row-actions">
                <button class="link" type="button" @click="editRange(range)">编辑</button>
                <button class="link danger" type="button" @click="deleteRangeRow(range)">删除</button>
              </td>
            </tr>
            <tr v-if="!deviceRanges.length">
              <td colspan="6" class="empty-state">该装置名下还没有范围条目</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  createSetting,
  missingFields,
  returnSetting,
  reviewSetting,
  saveSettingDraft,
  submitSetting,
  voidSetting,
  type SettingDraft,
} from '@/api/setting-service'
import {
  devicesFromRows,
  latestVersion,
  listItems,
  listRanges,
  removeRange,
  saveRange,
  type SettingRange,
} from '@/data/setting-ranges'
import { evaluateGate, emptyGate, type GateResult } from '@/data/setting-gate'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('settingvalue')
const columns = ['定值单号', '所属装置', '定值项目', '整定值', '计算依据', '整定人', '审核人', '范围版本']
const statuses = ['待整定', '整定中', '待复核', '已复核', '已作废']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待整定定值单', value: rows.value.filter((row) => row.status === '待整定').length },
  { label: '整定中定值单', value: rows.value.filter((row) => row.status === '整定中').length },
  { label: '待专责复核', value: rows.value.filter((row) => row.status === '待复核').length },
  { label: '已复核待送审', value: rows.value.filter((row) => row.status === '已复核').length },
])

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '定值整定列表读取失败'
  }
}

// ---------- 行内展示：缺格、版本、闸门 ----------

function isMissing(row: EntryRow, column: string): boolean {
  return (
    missingFields(row).includes(column) &&
    !['已复核', '已作废'].includes(String(row.status))
  )
}

function versionText(row: EntryRow): string {
  const version = Number(row['范围版本'] ?? 0)
  return version > 0 ? `v${version}` : '—'
}

function valueGate(row: EntryRow): GateResult {
  return evaluateGate(
    String(row['所属装置'] ?? ''),
    String(row['定值项目'] ?? ''),
    String(row['整定值'] ?? ''),
  )
}

function isOverLimit(row: EntryRow): boolean {
  if (['已作废'].includes(String(row.status))) {
    return false
  }
  const gate = valueGate(row)
  return gate.verdict === 'below' || gate.verdict === 'over'
}

type GateView = { tone: 'pass' | 'fail' | 'warn' | 'idle'; text: string }

function gateView(row: EntryRow): GateView {
  const status = String(row.status)
  if (status === '已作废') {
    return { tone: 'idle', text: '—' }
  }
  const live = valueGate(row)
  const storedVersion = Number(row['范围版本'] ?? 0)
  const deviceLatest = latestVersion(String(row['所属装置'] ?? ''))

  if (status === '已复核') {
    return { tone: 'pass', text: `复核合格 · 按范围 v${storedVersion || deviceLatest}` }
  }
  if (status === '待复核') {
    if (deviceLatest > storedVersion) {
      if (live.verdict === 'pass') {
        return { tone: 'warn', text: `范围已升至 v${deviceLatest}，数值仍合格，专责复核将按新版重比` }
      }
      return { tone: 'fail', text: `范围已升至 v${deviceLatest}：${live.message}` }
    }
    if (live.verdict === 'pass') {
      return { tone: 'pass', text: `闸门合格 · 范围 v${storedVersion}` }
    }
    return { tone: 'fail', text: live.message }
  }
  if (live.verdict === 'pass') {
    return { tone: 'pass', text: live.message }
  }
  if (live.verdict === 'below' || live.verdict === 'over' || live.verdict === 'badvalue' || live.verdict === 'norange') {
    return { tone: live.verdict === 'norange' ? 'warn' : 'fail', text: live.message }
  }
  return { tone: 'idle', text: '待填写' }
}

function rowActions(status: string): string[] {
  switch (status) {
    case '待整定':
      return ['填写整定', '作废定值']
    case '整定中':
      return ['修改整定', '确认送复核', '作废定值']
    case '待复核':
      return ['复核通过', '退回重填']
    default:
      return []
  }
}

function handleAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '填写整定' || action === '修改整定') {
    openEdit(row)
    return
  }
  const id = Number(row.id)
  let result
  if (action === '确认送复核') {
    result = submitSetting(id)
  } else if (action === '复核通过') {
    result = reviewSetting(id)
  } else if (action === '退回重填') {
    result = returnSetting(id)
  } else {
    result = voidSetting(id)
  }
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

// ---------- 登记 / 整定弹窗 ----------

const formVisible = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const editingId = ref(0)
const formError = ref('')
const emptyForm = (): SettingDraft => ({
  定值单号: '',
  所属装置: '',
  定值项目: '',
  整定值: '',
  计算依据: '',
  整定人: '值班管理员',
})
const form = ref<SettingDraft>(emptyForm())

const deviceOptions = computed(() => devicesFromRows(rows.value))
const itemOptions = computed(() => listItems(form.value.所属装置))
const formMissing = computed(() => missingFields(form.value))
const formGate = computed<GateResult>(() => {
  if (!form.value.所属装置 || !form.value.定值项目) {
    return emptyGate()
  }
  return evaluateGate(form.value.所属装置, form.value.定值项目, form.value.整定值)
})

function openCreate() {
  formMode.value = 'create'
  form.value = emptyForm()
  formError.value = ''
  formVisible.value = true
}

function openEdit(row: EntryRow) {
  formMode.value = 'edit'
  editingId.value = Number(row.id)
  form.value = {
    定值单号: String(row['定值单号'] ?? ''),
    所属装置: String(row['所属装置'] ?? ''),
    定值项目: String(row['定值项目'] ?? ''),
    整定值: String(row['整定值'] ?? ''),
    计算依据: String(row['计算依据'] ?? ''),
    整定人: String(row['整定人'] ?? '') || '值班管理员',
  }
  formError.value = ''
  formVisible.value = true
}

function closeForm() {
  formVisible.value = false
}

function confirmCreate() {
  formError.value = ''
  const result = createSetting(form.value)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  closeForm()
  errorMessage.value = result.message
  reload()
}

function confirmSave() {
  formError.value = ''
  const result = saveSettingDraft(editingId.value, { ...form.value })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  closeForm()
  errorMessage.value = result.message
  reload()
}

function confirmSubmit() {
  formError.value = ''
  const saved = saveSettingDraft(editingId.value, { ...form.value })
  if (!saved.ok) {
    formError.value = saved.message
    return
  }
  if (saved.missing.length > 0) {
    formError.value = `退回重填：还缺 ${saved.missing.join('、')}`
    reload()
    return
  }
  if (saved.gate.verdict !== 'pass') {
    formError.value = `退回重填：${saved.gate.message}`
    reload()
    return
  }
  const result = submitSetting(editingId.value)
  if (!result.ok) {
    formError.value = result.message
    reload()
    return
  }
  closeForm()
  errorMessage.value = result.message
  reload()
}

// ---------- 范围维护弹窗 ----------

const rangeVisible = ref(false)
const rangeError = ref('')
const rangeRefresh = ref(0)
const rangeEditing = ref<{ device: string; item: string } | null>(null)
const rangeForm = ref({ device: '', item: '', lower: '', upper: '', unit: '' })

const rangeItemOptions = computed(() => {
  void rangeRefresh.value
  return listItems(rangeForm.value.device)
})

const deviceRanges = computed<SettingRange[]>(() => {
  void rangeRefresh.value
  return listRanges().filter((range) => range.device === rangeForm.value.device)
})

const deviceVersion = computed(() => {
  void rangeRefresh.value
  return latestVersion(rangeForm.value.device)
})

function openRanges() {
  rangeVisible.value = true
  rangeError.value = ''
  resetRangeForm()
}

function closeRanges() {
  rangeVisible.value = false
}

function resetRangeForm() {
  rangeForm.value = { device: '', item: '', lower: '', upper: '', unit: '' }
  rangeEditing.value = null
  rangeError.value = ''
}

function onRangeDeviceChange() {
  // 切换装置后条目列表靠 computed 自动刷新，编辑态清空避免误改到别的装置。
  rangeEditing.value = null
}

function editRange(range: SettingRange) {
  rangeForm.value = {
    device: range.device,
    item: range.item,
    lower: String(range.lower),
    upper: String(range.upper),
    unit: range.unit,
  }
  rangeEditing.value = { device: range.device, item: range.item }
  rangeError.value = ''
}

function deleteRangeRow(range: SettingRange) {
  removeRange(range.device, range.item)
  rangeRefresh.value += 1
  if (rangeEditing.value?.device === range.device && rangeEditing.value?.item === range.item) {
    resetRangeForm()
  }
  reload()
}

function saveRangeForm() {
  rangeError.value = ''
  const device = rangeForm.value.device.trim()
  const item = rangeForm.value.item.trim()
  if (!device || !item) {
    rangeError.value = '装置与定值项目都要填写'
    return
  }
  const lower = Number(rangeForm.value.lower)
  const upper = Number(rangeForm.value.upper)
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    rangeError.value = '上下限必须是数字'
    return
  }
  if (lower > upper) {
    rangeError.value = '下限不能高于上限'
    return
  }
  saveRange(
    { device, item, lower, upper, unit: rangeForm.value.unit.trim() },
    rangeEditing.value ?? undefined,
  )
  rangeRefresh.value += 1
  rangeForm.value = { device, item: '', lower: '', upper: '', unit: '' }
  rangeEditing.value = null
  reload()
}

onMounted(reload)
</script>
