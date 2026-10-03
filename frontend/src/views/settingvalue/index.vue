<template>
  <section class="page" data-module="settingvalue">
    <header class="page-head">
      <div>
        <h2>定值整定管理</h2>
        <p class="page-desc">
          每类保护按装置铭牌范围设上下限，整定确认时先过闸门：压边界算合格，越限或缺格原地退回重填；
          专责复核通过后自动进入定值审批的待送审清单，反复送复核不会重复建单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记定值单</button>
        <button class="btn" type="button" @click="goRanges">维护整定范围</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ warn: item.value > 0 }">{{ item.value }}</strong>
      </article>
    </div>

    <div class="tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        role="tab"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 定值单 -->
    <template v-if="activeTab === 'sheets'">
      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>关键字</span>
          <input v-model="keyword" placeholder="定值单号 / 装置 / 项目 / 依据" />
        </label>
        <label class="filter-item">
          <span>状态</span>
          <select v-model="statusFilter">
            <option value="">全部</option>
            <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
          </select>
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table setting-table">
        <thead>
          <tr>
            <th v-for="column in sheetColumns" :key="column">{{ column }}</th>
            <th>范围闸门</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visibleRows" :key="String(row.id)" :class="{ 'row-abnormal': row.abnormal }">
            <td v-for="column in sheetColumns" :key="column">
              <template v-if="editableStatuses.includes(String(row.status)) && editableFields.includes(column)">
                <select
                  v-if="column === '所属装置'"
                  class="cell-input"
                  :value="String(row[column] ?? '')"
                  @change="onCellEdit(row, column, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">请选择装置</option>
                  <option v-for="device in deviceOptions" :key="String(device.id)" :value="cellDevice(device)">
                    {{ cellDevice(device) }}（{{ device['装置型号'] }}）
                  </option>
                </select>
                <input
                  v-else-if="column === '保护类别'"
                  class="cell-input"
                  list="category-list"
                  :value="String(row[column] ?? '')"
                  @change="onCellEdit(row, column, ($event.target as HTMLInputElement).value)"
                />
                <input
                  v-else
                  class="cell-input"
                  :value="String(row[column] ?? '')"
                  @change="onCellEdit(row, column, ($event.target as HTMLInputElement).value)"
                />
              </template>
              <template v-else>
                {{ displayCell(row, column) }}
              </template>
              <p v-if="issueMap.get(String(row.id))?.get(column)" class="cell-error">
                {{ issueMap.get(String(row.id))?.get(column) }}
              </p>
            </td>
            <td>
              <span class="verdict" :class="verdicts.get(String(row.id))?.ok ? 'pass' : 'fail'">
                {{ verdicts.get(String(row.id))?.ok ? '合格' : '未过' }}
              </span>
              <p v-if="verdicts.get(String(row.id))" class="verdict-text">
                {{ verdicts.get(String(row.id))?.message }}
              </p>
            </td>
            <td>
              <span :class="['status-tag', statusClass(String(row.status))]">{{ row.status }}</span>
            </td>
            <td class="row-actions">
              <button
                v-if="['待整定', '退回重填'].includes(String(row.status))"
                class="link"
                type="button"
                @click="onConfirm(row)"
              >
                整定确认
              </button>
              <button
                v-if="String(row.status) === '待复核'"
                class="link"
                type="button"
                @click="openReview(row)"
              >
                专责复核
              </button>
              <button v-if="String(row.status) !== '已作废'" class="link danger" type="button" @click="onInvalidate(row)">
                作废
              </button>
              <span v-if="String(row.status) === '已作废'" class="muted-text">无</span>
            </td>
          </tr>
          <tr v-if="!visibleRows.length">
            <td :colspan="sheetColumns.length + 3" class="empty-state">暂无符合条件的定值单</td>
          </tr>
        </tbody>
      </table>
      <datalist id="category-list">
        <option v-for="category in categoryOptions" :key="category" :value="category" />
      </datalist>

      <footer class="page-foot">
        <span>共 {{ visibleRows.length }} 张定值单（闸门实时按各装置最新版本范围判定）</span>
        <span v-if="actionMessage" :class="actionOk ? 'ok-text' : 'error-text'">{{ actionMessage }}</span>
      </footer>
    </template>

    <!-- 整定范围 -->
    <template v-else>
      <div class="filter-bar">
        <label class="filter-item">
          <span>所属装置</span>
          <select v-model="rangeDevice">
            <option value="">全部装置</option>
            <option v-for="device in rangeDeviceRows" :key="String(device.id)" :value="String(device['所属装置'])">
              {{ device['所属装置'] }}
            </option>
          </select>
        </label>
        <label class="check-item">
          <input v-model="showArchived" type="checkbox" />
          显示已归档历史版本
        </label>
        <button class="btn primary" type="button" @click="openRangeCreate()">登记新范围</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>范围编号</th>
            <th>所属装置</th>
            <th>保护类别</th>
            <th>下限</th>
            <th>上限</th>
            <th>单位</th>
            <th>版本</th>
            <th>生效日期</th>
            <th>状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="range in visibleRanges" :key="String(range.id)" :class="{ archived: range['状态'] === '已归档' }">
            <td>{{ range['范围编号'] }}</td>
            <td>{{ range['所属装置'] }}</td>
            <td>{{ range['保护类别'] }}</td>
            <td>{{ range['下限'] }}</td>
            <td>{{ range['上限'] }}</td>
            <td>{{ range['单位'] }}</td>
            <td>v{{ range['版本'] }}</td>
            <td>{{ range['生效日期'] }}</td>
            <td>
              <span :class="['status-tag', range['状态'] === '现行' ? 'ok' : 'muted']">{{ range['状态'] }}</span>
            </td>
            <td class="row-actions">
              <button
                v-if="range['状态'] === '现行'"
                class="link"
                type="button"
                @click="openRangeCreate(range)"
              >
                调整范围
              </button>
              <span v-else class="muted-text">已归档</span>
            </td>
          </tr>
          <tr v-if="!visibleRanges.length">
            <td colspan="10" class="empty-state">该装置还没有整定范围，先登记上下限</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>同一台装置下多张定值单共用这一份范围；调整后旧版归档，闸门按最新一版比。</span>
        <span v-if="actionMessage" :class="actionOk ? 'ok-text' : 'error-text'">{{ actionMessage }}</span>
      </footer>
    </template>

    <!-- 登记定值单 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>登记定值单</h3>
        <p class="modal-hint">定值单号自动生成；保存为「待整定」后，由整定人点「整定确认」过闸门。</p>
        <label v-for="field in createFields" :key="field.key" class="form-item">
          <span>{{ field.label }}<em v-if="field.required">*</em></span>
          <select v-if="field.key === 'device'" v-model="createForm[field.key]">
            <option value="">请选择装置</option>
            <option v-for="device in deviceOptions" :key="String(device.id)" :value="cellDevice(device)">
              {{ cellDevice(device) }}（{{ device['装置型号'] }}）
            </option>
          </select>
          <input
            v-else-if="field.key === 'category'"
            v-model="createForm[field.key]"
            list="category-list"
            placeholder="如：差动电流启动值"
          />
          <input
            v-else
            v-model="createForm[field.key]"
            :placeholder="field.placeholder ?? ''"
          />
        </label>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="submit">保存定值单</button>
        </div>
      </form>
    </div>

    <!-- 专责复核 -->
    <div v-if="reviewRow" class="modal-mask" @click.self="reviewRow = null">
      <form class="modal" @submit.prevent="submitReview">
        <h3>专责复核 · {{ reviewRow['定值单号'] }}</h3>
        <p class="modal-hint">
          复核时按最新一版范围重新比一遍；通过后推进到定值审批的待送审清单，同一张单子不会重复建审批单。
        </p>
        <div class="verdict-box" :class="reviewVerdict?.ok ? 'pass' : 'fail'">
          {{ reviewVerdict?.message }}
        </div>
        <label class="form-item">
          <span>专责复核人<em>*</em></span>
          <input v-model="reviewer" placeholder="请输入复核人姓名" />
        </label>
        <p v-if="reviewError" class="error-text">{{ reviewError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="reviewRow = null">取消</button>
          <button class="btn primary" type="submit" :disabled="!reviewVerdict?.ok">
            复核通过并送待送审
          </button>
        </div>
      </form>
    </div>

    <!-- 登记 / 调整范围 -->
    <div v-if="rangeOpen" class="modal-mask" @click.self="rangeOpen = false">
      <form class="modal" @submit.prevent="submitRange">
        <h3>{{ rangeDraft ? `调整范围 · ${rangeDraft['所属装置']} ${rangeDraft['保护类别']}` : '登记整定范围' }}</h3>
        <p class="modal-hint">
          <template v-if="rangeDraft">
            现行 v{{ rangeDraft['版本'] }}：{{ rangeDraft['下限'] }}～{{ rangeDraft['上限'] }} {{ rangeDraft['单位'] }}；
            保存后旧版归档、生成 v{{ Number(rangeDraft['版本']) + 1 }}，新单子与复核都按新版比。
          </template>
          <template v-else>每类保护单独定义上限与下限；正好压在边界上的整定值算合格。</template>
        </p>
        <label class="form-item">
          <span>所属装置<em>*</em></span>
          <select v-model="rangeForm.device" :disabled="Boolean(rangeDraft)">
            <option value="">请选择装置</option>
            <option v-for="device in deviceOptions" :key="String(device.id)" :value="cellDevice(device)">
              {{ cellDevice(device) }}（{{ device['装置型号'] }}）
            </option>
          </select>
        </label>
        <label class="form-item">
          <span>保护类别<em>*</em></span>
          <input
            v-model="rangeForm.category"
            list="category-list"
            :disabled="Boolean(rangeDraft)"
            placeholder="如：差动电流启动值"
          />
        </label>
        <div class="form-row">
          <label class="form-item">
            <span>下限<em>*</em></span>
            <input v-model="rangeForm.lower" inputmode="decimal" placeholder="如 0.3" />
          </label>
          <label class="form-item">
            <span>上限<em>*</em></span>
            <input v-model="rangeForm.upper" inputmode="decimal" placeholder="如 1" />
          </label>
          <label class="form-item">
            <span>单位</span>
            <input v-model="rangeForm.unit" list="unit-list" placeholder="如 A / s / Ω / In" />
          </label>
        </div>
        <datalist id="unit-list">
          <option value="A"></option>
          <option value="In"></option>
          <option value="s"></option>
          <option value="Ω"></option>
          <option value="V"></option>
        </datalist>
        <p v-if="rangeError" class="error-text">{{ rangeError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="rangeOpen = false">取消</button>
          <button class="btn primary" type="submit">{{ rangeDraft ? '生成新版本' : '保存范围' }}</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  adjustRange,
  confirmSetting,
  createRange,
  createSetting,
  deviceUnitFor,
  evaluateSheet,
  invalidateSetting,
  listCategories,
  listDeviceOptions,
  listRangeDevices,
  listRanges,
  listSettings,
  reviewSetting,
  updateSettingCell,
} from '@/api/setting-service'
import { useSessionStore } from '@/stores/session'
import type { GateVerdict } from '@/api/setting-service'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()

const tabs = [
  { key: 'sheets', label: '定值单' },
  { key: 'ranges', label: '整定范围（按装置共用）' },
] as const
const activeTab = ref<(typeof tabs)[number]['key']>('sheets')

const sheetColumns = [
  '定值单号',
  '所属装置',
  '保护类别',
  '定值项目',
  '整定值',
  '单位',
  '计算依据',
  '整定人',
  '复核人',
  '复核时间',
  '适用版本',
  '关联审批单',
]
const editableFields = ['定值单号', '所属装置', '保护类别', '定值项目', '整定值', '单位', '计算依据']
const editableStatuses = ['待整定', '退回重填']
const statuses = ['待整定', '待复核', '退回重填', '已复核', '已作废']

const rows = ref<EntryRow[]>([])
const deviceOptions = ref<EntryRow[]>([])
const keyword = ref('')
const statusFilter = ref('')
const actionMessage = ref('')
const actionOk = ref(true)

function cellDevice(device: EntryRow): string {
  return String(device['装置编号'] ?? '')
}

function displayCell(row: EntryRow, column: string): string {
  const value = row[column]
  if (value === undefined || value === null || String(value) === '') {
    return '—'
  }
  return String(value)
}

const verdicts = computed<Map<string, GateVerdict>>(() => {
  const map = new Map<string, GateVerdict>()
  for (const row of rows.value) {
    map.set(String(row.id), evaluateSheet(row))
  }
  return map
})

const issueMap = computed<Map<string, Map<string, string>>>(() => {
  const map = new Map<string, Map<string, string>>()
  for (const row of rows.value) {
    const verdict = verdicts.value.get(String(row.id))
    if (!verdict || verdict.ok) {
      continue
    }
    const perField = new Map<string, string>()
    for (const issue of verdict.fieldIssues) {
      perField.set(issue.field, issue.message)
    }
    map.set(String(row.id), perField)
  }
  return map
})

const visibleRows = computed(() => {
  const word = keyword.value.trim()
  return rows.value.filter((row) => {
    if (statusFilter.value && String(row.status) !== statusFilter.value) {
      return false
    }
    if (!word) {
      return true
    }
    return ['定值单号', '所属装置', '保护类别', '定值项目', '计算依据'].some((field) =>
      String(row[field] ?? '').includes(word),
    )
  })
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待整定', value: countStatus('待整定'), warn: false },
  { label: '待复核', value: countStatus('待复核'), warn: false },
  { label: '退回重填', value: countStatus('退回重填'), warn: true },
  { label: '已复核（已送待送审）', value: countStatus('已复核'), warn: false },
  { label: '已作废', value: countStatus('已作废'), warn: false },
])

function countStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function statusClass(status: string): string {
  if (status === '已复核') {
    return 'ok'
  }
  if (status === '退回重填') {
    return 'fail'
  }
  if (status === '已作废') {
    return 'muted'
  }
  return 'pending'
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = ''
}

function flash(result: { ok: boolean; message: string }) {
  actionOk.value = result.ok
  actionMessage.value = result.message
}

// 登记定值单弹窗
const createOpen = ref(false)
const createError = ref('')
const createFields: { key: keyof typeof createForm; label: string; required: boolean; placeholder?: string }[] = [
  { key: 'device', label: '所属装置', required: true },
  { key: 'category', label: '保护类别', required: true },
  { key: 'project', label: '定值项目', required: true },
  { key: 'value', label: '整定值', required: true, placeholder: '只填数字，单位在下行' },
  { key: 'unit', label: '单位', required: false },
  { key: 'basis', label: '计算依据', required: true },
]

const createForm = reactive({
  device: '',
  category: '',
  project: '',
  value: '',
  unit: '',
  basis: '',
})

function openCreate() {
  createForm.device = ''
  createForm.category = ''
  createForm.project = ''
  createForm.value = ''
  createForm.unit = ''
  createForm.basis = ''
  createError.value = ''
  createOpen.value = true
}

function submitCreate() {
  const result = createSetting({ ...createForm, operator: store.operator })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  reload()
  flash(result)
}

// 行内编辑：改装置/类别后自动带出最新版范围的单位。
function onCellEdit(row: EntryRow, field: string, value: string) {
  const result = updateSettingCell(Number(row.id), field, value)
  if (!result.ok) {
    flash(result)
    return
  }
  const refreshed = rows.value.find((item) => String(item.id) === String(row.id))
  if (!refreshed) {
    return
  }
  const device = field === '所属装置' ? value : String(refreshed['所属装置'] ?? '')
  const category = field === '保护类别' ? value : String(refreshed['保护类别'] ?? '')
  if ((field === '所属装置' || field === '保护类别') && device && category) {
    const unit = deviceUnitFor(device, category)
    if (unit) {
      updateSettingCell(Number(row.id), '单位', unit)
    }
  }
  reload()
  actionMessage.value = ''
}

function onConfirm(row: EntryRow) {
  flash(confirmSetting(Number(row.id)))
  reload()
}

function onInvalidate(row: EntryRow) {
  flash(invalidateSetting(Number(row.id)))
  reload()
}

// 专责复核弹窗
const reviewRow = ref<EntryRow | null>(null)
const reviewer = ref('')
const reviewError = ref('')

const reviewVerdict = computed<GateVerdict | undefined>(() =>
  reviewRow.value ? evaluateSheet(reviewRow.value) : undefined,
)

function openReview(row: EntryRow) {
  // 范围可能刚被调整过，打开弹窗前取最新一版行数据再判定。
  const fresh = listSettings().find((item) => String(item.id) === String(row.id)) ?? row
  reviewRow.value = fresh
  reviewer.value = store.operator
  reviewError.value = ''
}

function submitReview() {
  if (!reviewRow.value) {
    return
  }
  const result = reviewSetting(Number(reviewRow.value.id), reviewer.value)
  flash(result)
  if (!result.ok) {
    reviewError.value = result.message
    reload()
    reviewRow.value = null
    return
  }
  reviewRow.value = null
  reload()
}

// 整定范围
const rangeDevice = ref('')
const showArchived = ref(false)
const rangeDeviceRows = computed(() => listRangeDevices())
const visibleRanges = computed(() => listRanges(rangeDevice.value, showArchived.value))
const categoryOptions = computed(() => listCategories())

const rangeOpen = ref(false)
const rangeDraft = ref<EntryRow | null>(null)
const rangeError = ref('')
const rangeForm = reactive({ device: '', category: '', upper: '', lower: '', unit: '' })

function goRanges() {
  activeTab.value = 'ranges'
  reload()
}

function openRangeCreate(range?: EntryRow) {
  rangeDraft.value = range ?? null
  rangeError.value = ''
  if (range) {
    rangeForm.device = String(range['所属装置'])
    rangeForm.category = String(range['保护类别'])
    rangeForm.upper = String(range['上限'])
    rangeForm.lower = String(range['下限'])
    rangeForm.unit = String(range['单位'] ?? '')
  } else {
    rangeForm.device = rangeDevice.value
    rangeForm.category = ''
    rangeForm.upper = ''
    rangeForm.lower = ''
    rangeForm.unit = ''
  }
  rangeOpen.value = true
}

function submitRange() {
  const payload = {
    device: rangeForm.device,
    category: rangeForm.category,
    upper: rangeForm.upper,
    lower: rangeForm.lower,
    unit: rangeForm.unit,
  }
  const result = rangeDraft.value ? adjustRange(payload) : createRange(payload)
  if (!result.ok) {
    rangeError.value = result.message
    return
  }
  rangeOpen.value = false
  reload()
  flash(result)
}

function reload() {
  rows.value = listSettings()
  deviceOptions.value = listDeviceOptions()
}

onMounted(reload)
</script>
