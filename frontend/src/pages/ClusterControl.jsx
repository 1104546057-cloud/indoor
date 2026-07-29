/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LabBuilding3DPreview from '../components/LabBuilding3DPreview'
import RouteManagementPanel from '../components/RouteManagementPanel'
import { hanlinRoomMap, inspectionPointById } from '../data/hanlinRoomMap'
import { labBuildingMap, labInspectionPointById } from '../data/labBuildingMap'
import { getInspectionResults, subscribeInspectionResults, updateInspectionResultReview } from '../utils/inspectionResults'
import { buildNavigationGoals, buildNavigationGoalsFromPoints, isPointInsideSlamCoverage } from '../utils/navigationCoordinates'
import {
  buildPatrolMonitorUrl,
  getNavigationExecutionId,
  loadPatrolMonitorContext,
  savePatrolMonitorContext,
} from '../utils/patrolMonitor'
import '../styles/ClusterControl.css'
import '../styles/BusinessModules.css'

const tabs = [
  { id: 'plan', label: '巡检计划' },
  { id: 'routes', label: '巡检点与路线' },
  { id: 'records', label: '巡检记录' },
  { id: 'ai', label: 'AI识别记录' },
  { id: 'report', label: '巡检报告' },
]

const sceneMaps = {
  'power-room': hanlinRoomMap,
  'lab-building': labBuildingMap,
}

const allInspectionPointById = {
  ...inspectionPointById,
  ...labInspectionPointById,
}

const NAVIGATION_SPEED = 0.35
const ARRIVAL_DIRECTIONS = [
  { value: 'east', label: '东（0°）' },
  { value: 'north', label: '北（90°）' },
  { value: 'west', label: '西（180°）' },
  { value: 'south', label: '南（-90°）' },
]
const ARRIVAL_DIRECTION_VALUES = new Set(ARRIVAL_DIRECTIONS.map((item) => item.value))
const DIRECTION_VECTORS = {
  east: { x: 1, y: 0 },
  north: { x: 0, y: -1 },
  west: { x: -1, y: 0 },
  south: { x: 0, y: 1 },
}

function getSceneMap(sceneId = 'power-room') {
  return sceneMaps[sceneId] || hanlinRoomMap
}

const initialTasks = [
  {
    id: 'task-a1',
    name: 'A1通道巡检',
    area: 'A区 / 通道A1',
    robot: 'nano1',
    start: '2026-06-17 08:30',
    status: '执行中',
    progress: 65,
    detail: { pointTotal: 8, currentPoint: 5, eta: '09:20', abnormalCount: 1 },
    timeline: [
      { time: '08:30', label: '创建任务', type: 'DOC', state: 'done' },
      { time: '08:35', label: '机器人启动', type: 'GO', state: 'done' },
      { time: '08:42', label: '到达巡检点', type: 'POS', state: 'done' },
      { time: '08:45', label: '完成表计识别', type: 'AI', state: 'done' },
      { time: '08:53', label: '上传识别结果', type: 'UP', state: 'active' },
      { time: '09:10', label: '巡检完成', type: 'END', state: 'pending' },
    ],
    aiPreview: [
      { title: '电压表识别', value: '380 V', confidence: '97.3%', time: '08:45:12', status: '正常', visual: 'meter' },
      { title: '电流表识别', value: '36.2 A', confidence: '96.8%', time: '08:45:18', status: '正常', visual: 'meter' },
      { title: '温度表识别', value: '65.4 C', confidence: '94.1%', time: '08:45:25', status: '告警', visual: 'digital' },
    ],
  },
  {
    id: 'task-b2',
    name: 'B2机房巡检',
    area: 'B区 / 机房B2',
    robot: 'nano2',
    start: '2026-06-17 10:00',
    status: '待执行',
    progress: 0,
    detail: { pointTotal: 6, currentPoint: 0, eta: '10:35', abnormalCount: 0 },
    timeline: [
      { time: '10:00', label: '等待任务启动', type: 'WAIT', state: 'pending' },
      { time: '--:--', label: '机器人启动', type: 'GO', state: 'pending' },
      { time: '--:--', label: '到达机房入口', type: 'POS', state: 'pending' },
      { time: '--:--', label: '完成柜体识别', type: 'AI', state: 'pending' },
      { time: '--:--', label: '上传识别结果', type: 'UP', state: 'pending' },
      { time: '--:--', label: '巡检完成', type: 'END', state: 'pending' },
    ],
    aiPreview: [
      { title: '等待采集', value: '--', confidence: '--', time: '--:--:--', status: '待执行', visual: 'digital' },
      { title: '等待识别', value: '--', confidence: '--', time: '--:--:--', status: '待执行', visual: 'digital' },
      { title: '等待复核', value: '--', confidence: '--', time: '--:--:--', status: '待执行', visual: 'digital' },
    ],
  },
  {
    id: 'task-c1',
    name: 'C1水泵房巡检',
    area: 'C区 / 水泵房C1',
    robot: 'nano3',
    start: '2026-06-17 14:00',
    status: '待执行',
    progress: 0,
    detail: { pointTotal: 6, currentPoint: 0, eta: '14:40', abnormalCount: 0 },
    timeline: [
      { time: '14:00', label: '等待任务启动', type: 'WAIT', state: 'pending' },
      { time: '--:--', label: '机器人启动', type: 'GO', state: 'pending' },
      { time: '--:--', label: '到达水泵房', type: 'POS', state: 'pending' },
      { time: '--:--', label: '完成温度识别', type: 'AI', state: 'pending' },
      { time: '--:--', label: '上传识别结果', type: 'UP', state: 'pending' },
      { time: '--:--', label: '巡检完成', type: 'END', state: 'pending' },
    ],
    aiPreview: [
      { title: '泵体温度', value: '--', confidence: '--', time: '--:--:--', status: '待执行', visual: 'digital' },
      { title: '压力表识别', value: '--', confidence: '--', time: '--:--:--', status: '待执行', visual: 'meter' },
      { title: '液位状态', value: '--', confidence: '--', time: '--:--:--', status: '待执行', visual: 'digital' },
    ],
  },
  {
    id: 'task-power',
    name: '配电房日常巡检',
    area: 'A区 / 配电房',
    robot: 'nano1',
    start: '2026-06-17 15:30',
    status: '已完成',
    progress: 100,
    detail: { pointTotal: 10, currentPoint: 10, eta: '16:18', abnormalCount: 0 },
    timeline: [
      { time: '15:30', label: '创建任务', type: 'DOC', state: 'done' },
      { time: '15:34', label: '机器人启动', type: 'GO', state: 'done' },
      { time: '15:42', label: '到达配电房', type: 'POS', state: 'done' },
      { time: '15:58', label: '完成柜体识别', type: 'AI', state: 'done' },
      { time: '16:12', label: '上传识别结果', type: 'UP', state: 'done' },
      { time: '16:18', label: '巡检完成', type: 'END', state: 'done' },
    ],
    aiPreview: [
      { title: '柜门状态', value: '关闭', confidence: '98.5%', time: '15:58:11', status: '正常', visual: 'digital' },
      { title: '电压表识别', value: '381 V', confidence: '97.9%', time: '16:02:25', status: '正常', visual: 'meter' },
      { title: '指示灯识别', value: '绿色', confidence: '96.4%', time: '16:08:03', status: '正常', visual: 'digital' },
    ],
  },
  {
    id: 'task-b1-night',
    name: 'B1通道夜间巡检',
    area: 'B区 / 通道B1',
    robot: 'nano2',
    start: '2026-06-16 23:00',
    status: '异常',
    progress: 80,
    detail: { pointTotal: 8, currentPoint: 6, eta: '待复核', abnormalCount: 2 },
    timeline: [
      { time: '23:00', label: '创建任务', type: 'DOC', state: 'done' },
      { time: '23:04', label: '机器人启动', type: 'GO', state: 'done' },
      { time: '23:18', label: '到达巡检点', type: 'POS', state: 'done' },
      { time: '23:21', label: '温度识别异常', type: 'AI', state: 'alarm' },
      { time: '23:24', label: '等待人工复核', type: 'RV', state: 'active' },
      { time: '--:--', label: '巡检完成', type: 'END', state: 'pending' },
    ],
    aiPreview: [
      { title: '温度表识别', value: '72.8 C', confidence: '95.2%', time: '23:21:08', status: '告警', visual: 'digital' },
      { title: '电流表识别', value: '41.6 A', confidence: '93.6%', time: '23:21:16', status: '告警', visual: 'meter' },
      { title: '开关状态', value: '合闸', confidence: '96.1%', time: '23:22:03', status: '正常', visual: 'digital' },
    ],
  },
]

const wholeRoomScope = {
  id: 'whole-room',
  name: '整房巡检范围',
  area: `${hanlinRoomMap.name} / 整房巡检`,
  robot: 'nano1',
  priority: '项',
}

const routeTemplates = [
  {
    ...wholeRoomScope,
    name: '整房全量巡检任务',
    meta: `${hanlinRoomMap.inspectionPoints.length} 个固定点 / 单车巡检`,
    pointIds: getAreaPointIds(),
  },
]

const taskColumns = ['任务名称', '区域', '机器人', '开始时间', '状态', '进度', '操作']
const archiveColumns = ['档案编号', '任务名称', '巡检时间', '用时', '点位', '异常', '复核', '操作']
const aiColumns = ['识别对象', '任务 / 点位', '识别值', '标准范围', '置信度', '状态', '复核', '操作']
const reportColumns = ['报告编号', '巡检任务', '巡检时间', '点位', '异常', '复核', '报告状态', '操作']

function getAreaPointIds(sceneId = 'power-room') {
  return getSceneMap(sceneId).inspectionPoints.map((point) => point.id)
}

function getNavigablePointIds(sceneId = 'power-room') {
  const mapData = getSceneMap(sceneId)
  if (!mapData.slamMap) {
    return getAreaPointIds(sceneId)
  }

  return mapData.inspectionPoints
    .filter((point) => isPointInsideSlamCoverage(point, mapData))
    .map((point) => point.id)
}

function getEstimatedMinutes(pointCount) {
  return Math.max(12, 8 + pointCount * 2)
}

function normalizeArrivalDirection(direction) {
  if (ARRIVAL_DIRECTION_VALUES.has(direction)) {
    return direction
  }

  if (typeof direction === 'number' && Number.isFinite(direction)) {
    const normalizedYaw = Math.atan2(Math.sin(direction), Math.cos(direction))
    return ARRIVAL_DIRECTIONS.reduce((closest, item) => {
      const itemYaw = {
        east: 0,
        north: Math.PI / 2,
        west: Math.PI,
        south: -Math.PI / 2,
      }[item.value]
      const distance = Math.abs(Math.atan2(
        Math.sin(normalizedYaw - itemYaw),
        Math.cos(normalizedYaw - itemYaw),
      ))
      return distance < closest.distance ? { value: item.value, distance } : closest
    }, { value: 'east', distance: Number.POSITIVE_INFINITY }).value
  }

  return 'east'
}

function getPlanPointDirection(point, pointDirections = {}) {
  return normalizeArrivalDirection(pointDirections[point?.id] ?? point?.direction ?? point?.yaw)
}

function getPlanRoutePoints(form) {
  if (form.sceneId === 'lab-building') {
    return (form.routePoints || []).map((point) => {
      const direction = getPlanPointDirection(point, form.pointDirections)
      return { ...point, direction, yaw: direction }
    })
  }

  const selectedPointIds = form.selectedPointIds || []

  return selectedPointIds
    .map((pointId) => allInspectionPointById[pointId])
    .filter(Boolean)
    .map((point) => {
      const direction = getPlanPointDirection(point, form.pointDirections)
      return { ...point, direction, yaw: direction }
    })
}

const defaultPlanForm = {
  name: '实验楼一层环廊巡检任务',
  sceneId: 'lab-building',
  roomId: labBuildingMap.id,
  areaId: wholeRoomScope.id,
  area: `${labBuildingMap.name} / 环形走廊`,
  robot: wholeRoomScope.robot,
  startDate: '2026-06-22',
  startTime: '09:30',
  selectedPointIds: [],
  routePoints: [],
  pointDirections: {},
  priority: wholeRoomScope.priority,
}

function getWaitingAiPreview() {
  return [
    { title: '等待采集', value: '--', confidence: '--', time: '--:--:--', status: '待执行', visual: 'digital' },
    { title: '等待识别', value: '--', confidence: '--', time: '--:--:--', status: '待执行', visual: 'digital' },
    { title: '等待复核', value: '--', confidence: '--', time: '--:--:--', status: '待执行', visual: 'digital' },
  ]
}

function createTaskFromForm(form) {
  const routePoints = getPlanRoutePoints(form)
  const selectedPointIds = routePoints.map((point) => point.id)
  const pointTotal = routePoints.length
  const duration = getEstimatedMinutes(pointTotal)
  const start = `${form.startDate} ${form.startTime}`
  const [hour, minute] = form.startTime.split(':').map(Number)
  const etaDate = new Date(2026, 0, 1, hour || 0, (minute || 0) + duration)
  const eta = `${String(etaDate.getHours()).padStart(2, '0')}:${String(etaDate.getMinutes()).padStart(2, '0')}`
  const taskId = `task-new-${Date.now()}`

  return {
    id: taskId,
    sceneId: form.sceneId,
    name: form.name.trim() || '新增巡检计划',
    area: form.area,
    robot: form.robot,
    routeId: `custom-${form.areaId}`,
    pointIds: selectedPointIds,
    routePoints,
    start,
    status: '待执行',
    progress: 0,
    priority: form.priority,
    detail: { pointTotal, currentPoint: 0, eta, abnormalCount: 0 },
    timeline: [
      { time: form.startTime, label: '等待任务启动', type: 'WAIT', state: 'pending' },
      { time: '--:--', label: '机器人启动', type: 'GO', state: 'pending' },
      { time: '--:--', label: `到达${routePoints[0]?.targetName || '首个巡检点'}`, type: 'POS', state: 'pending' },
      { time: '--:--', label: '完成 AI 识别', type: 'AI', state: 'pending' },
      { time: '--:--', label: '上传识别结果', type: 'UP', state: 'pending' },
      { time: '--:--', label: '巡检完成', type: 'END', state: 'pending' },
    ],
    aiPreview: getWaitingAiPreview(),
  }
}

async function fetchSavedTasks() {
  const response = await fetch('/api/tasks', { credentials: 'include' })
  if (!response.ok) {
    throw new Error('tasks request failed')
  }
  const data = await response.json()
  return Array.isArray(data.tasks) ? data.tasks : []
}

async function saveTask(task) {
  const response = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(task),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'task save failed')
  }
  return data.task || task
}

async function deleteSavedTask(taskId) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'task delete failed')
  }
  return data
}

function getAreaForm(area = wholeRoomScope) {
  const selectedPointIds = area.pointIds || getAreaPointIds()

  return {
    name: area.name.includes('任务') ? area.name : `${hanlinRoomMap.name}整房巡检任务`,
    sceneId: 'power-room',
    roomId: hanlinRoomMap.id,
    areaId: wholeRoomScope.id,
    area: wholeRoomScope.area,
    robot: area.robot,
    startDate: defaultPlanForm.startDate,
    startTime: defaultPlanForm.startTime,
    selectedPointIds,
    routePoints: [],
    pointDirections: {},
    priority: area.priority,
  }
}

function getTaskStats(taskList) {
  const count = (status) => taskList.filter((task) => task.status === status).length

  return [
    { label: '今日计划', value: String(taskList.length).padStart(2, '0'), unit: '项', tone: 'cyan', icon: 'CL' },
    { label: '执行中', value: String(count('执行中')).padStart(2, '0'), unit: '项', tone: 'green', icon: 'RUN' },
    { label: '已完成', value: String(count('已完成')).padStart(2, '0'), unit: '项', tone: 'blue', icon: 'OK' },
    { label: '待审核', value: String(count('待审核')).padStart(2, '0'), unit: '项', tone: 'amber', icon: 'RV' },
    { label: '异常任务', value: String(count('异常')).padStart(2, '0'), unit: '项', tone: 'red', icon: 'AL' },
  ]
}

function getStartedTask(task) {
  return {
    ...task,
    status: '执行中',
    progress: Math.max(task.progress, 5),
    detail: {
      ...task.detail,
      currentPoint: Math.max(task.detail.currentPoint, 1),
      eta: task.detail.eta === '待复核' ? '运行中...' : task.detail.eta,
    },
    timeline: [
      { time: task.start.slice(11, 16), label: '任务已启动', type: 'GO', state: 'active' },
      ...task.timeline.slice(1).map((item) => ({ ...item, state: item.state === 'done' ? 'done' : 'pending' })),
    ],
    aiPreview: task.aiPreview.map((item) => (
      item.value === '--' ? { ...item, status: '执行中', title: item.title.replace('等待', '准备') } : item
    )),
  }
}

function getPausedTask(task) {
  return {
    ...task,
    status: '待审核',
    detail: { ...task.detail, eta: '暂停待确认' },
    timeline: task.timeline.map((item, index) => (
      index === Math.min(4, task.timeline.length - 1)
        ? { time: '当前', label: '任务暂停待审核', type: 'RV', state: 'active' }
        : item
    )),
  }
}

function getReviewedTask(task) {
  return {
    ...task,
    status: '待审核',
    detail: { ...task.detail, eta: '复核中' },
    timeline: task.timeline.map((item) => (
      item.state === 'alarm' ? { ...item, label: `${item.label} / 已提交复核`, state: 'active' } : item
    )),
  }
}

function mapStoredResultToPreview(result) {
  return {
    title: `${result.targetName} / ${result.recognitionType}`,
    value: result.value,
    confidence: result.confidence,
    time: result.capturedAt?.split(' ').pop() || '--:--:--',
    status: result.status,
    visual: result.visual || (result.status === '异常' ? 'digital' : 'meter'),
    summary: result.summary,
    reviewStatus: result.reviewStatus,
  }
}

function getTaskEndTime(task) {
  if (task.status === '已完成') {
    const endNode = [...task.timeline].reverse().find((item) => item.state === 'done' && item.time !== '--:--')
    return `${task.start.slice(0, 10)} ${endNode?.time || task.detail.eta}`
  }

  if (task.status === '异常') {
    const alarmNode = task.timeline.find((item) => item.state === 'alarm')
    return `${task.start.slice(0, 10)} ${alarmNode?.time || task.start.slice(11, 16)}`
  }

  return `${task.start.slice(0, 10)} ${task.detail.eta}`
}

function getArchiveDuration(task) {
  if (task.status === '异常') {
    return '中断待复核'
  }

  const startMinute = Number(task.start.slice(11, 13)) * 60 + Number(task.start.slice(14, 16))
  const end = getTaskEndTime(task).slice(11, 16)
  const endMinute = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5))
  const minutes = Math.max(1, endMinute - startMinute)
  return `${minutes} 分钟`
}

function buildArchiveRecord(task, storedResults) {
  const relatedResults = storedResults.filter((result) => result.taskId === task.id)
  const abnormalCount = Math.max(
    task.detail.abnormalCount,
    relatedResults.filter((result) => result.status === '异常' || result.status === '告警').length,
  )
  const reviewedCount = relatedResults.filter((result) => result.reviewStatus && result.reviewStatus !== '待复核').length

  return {
    ...task,
    archiveNo: `ARC-${task.start.slice(2, 10).replaceAll('-', '')}-${task.robot.toUpperCase()}`,
    endTime: getTaskEndTime(task),
    duration: getArchiveDuration(task),
    abnormalCount,
    reviewedCount,
    reviewState: abnormalCount === 0 ? '无需复核' : (reviewedCount >= abnormalCount ? '已复核' : '待复核'),
    resultCount: relatedResults.length || task.aiPreview.length,
  }
}

function getTaskById(taskList, taskId) {
  return taskList.find((task) => task.id === taskId) || taskList[0]
}

function getDemoStandardRange(item) {
  if (item.title.includes('电压')) return '360 - 400 V'
  if (item.title.includes('电流')) return '0 - 40 A'
  if (item.title.includes('温度')) return '0 - 70 C'
  if (item.title.includes('柜门')) return '关闭'
  if (item.title.includes('指示灯')) return '绿色'
  return '符合标准'
}

function buildAiRecords(taskList, storedResults) {
  const storedRecords = storedResults.map((result) => {
    const task = getTaskById(taskList, result.taskId)

    return {
      id: result.id,
      source: 'stored',
      taskId: task.id,
      taskName: task.name,
      area: task.area,
      robot: task.robot,
      targetName: result.targetName || '未命名点项',
      recognitionType: result.recognitionType || 'AI识别',
      pointName: result.pointName || result.targetName || '巡检点',
      value: result.value,
      standardRange: result.standardRange || result.standard || '按点位标项',
      confidence: result.confidence || '--',
      capturedAt: result.capturedAt || task.start,
      status: result.status || '正常',
      reviewStatus: result.reviewStatus || (result.status === '异常' || result.status === '告警' ? '待复核' : '无需复核'),
      visual: result.visual || (result.status === '异常' ? 'digital' : 'meter'),
      summary: result.summary || '识别结果已入项',
    }
  })

  const demoRecords = taskList.flatMap((task) => (
    task.aiPreview
      .filter((item) => item.value !== '--')
      .map((item, index) => ({
        id: `demo-${task.id}-${index}`,
        source: 'demo',
        taskId: task.id,
        taskName: task.name,
        area: task.area,
        robot: task.robot,
        targetName: item.title,
        recognitionType: item.title.includes('/') ? item.title.split('/').pop().trim() : item.title,
        pointName: `P${String(index + 1).padStart(2, '0')}`,
        value: item.value,
        standardRange: getDemoStandardRange(item),
        confidence: item.confidence,
        capturedAt: `${task.start.slice(0, 10)} ${item.time}`,
        status: item.status,
        reviewStatus: item.reviewStatus || (item.status === '告警' || item.status === '异常' ? '待复核' : '无需复核'),
        visual: item.visual,
        summary: `${task.name} / ${item.title}`,
      }))
  ))

  const storedIds = new Set(storedRecords.map((record) => `${record.taskId}-${record.targetName}-${record.value}`))
  return [
    ...storedRecords,
    ...demoRecords.filter((record) => !storedIds.has(`${record.taskId}-${record.targetName}-${record.value}`)),
  ]
}

function buildReportRecords(archiveRecords) {
  return archiveRecords.map((record) => {
    const reportStatus = record.reviewState === '待复核'
      ? '待复核'
      : (record.status === '异常' ? '待生成' : '已生成')

    return {
      ...record,
      reportNo: `RPT-${record.start.slice(2, 10).replaceAll('-', '')}-${record.robot.toUpperCase()}`,
      reportStatus,
      generatedAt: reportStatus === '已生成' ? `${record.start.slice(0, 10)} 17:05` : '--',
    }
  })
}

function TaskStatus({ status }) {
  return <span className={`task-status status-${status}`}>{status}</span>
}

function ProgressBar({ value, status }) {
  return (
    <div className="task-progress">
      <span>{value}%</span>
      <i className={`progress-track progress-${status}`}>
        <b style={{ width: `${value}%` }} />
      </i>
    </div>
  )
}

function PatrolArchiveView({ archiveRecords, selectedTask, onSelect, onReplay, onShowAi, onReport }) {
  const selectedArchive = archiveRecords.find((record) => record.id === selectedTask.id) || archiveRecords[0]
  const archiveStats = [
    { label: '历史档案', value: archiveRecords.length, unit: '项' },
    { label: '完成巡检', value: archiveRecords.filter((record) => record.status === '已完成').length, unit: '项' },
    { label: '异常追溯', value: archiveRecords.filter((record) => record.abnormalCount > 0).length, unit: '项' },
    { label: '待复核', value: archiveRecords.filter((record) => record.reviewState === '待复核').length, unit: '项' },
  ]

  return (
    <section className="console-panel archive-panel">
      <div className="panel-heading archive-heading">
        <div>
          <h2>历史巡检档案</h2>
          <p>只展示已完成、异常或已中断的巡检结果，用于回看全过程和追溯异常来源。</p>
        </div>
        <div className="task-filters archive-filters">
          <label>日期<select defaultValue="today"><option value="today">今日</option></select></label>
          <label>结论<select defaultValue="all"><option value="all">全部</option></select></label>
          <label>机器人<select defaultValue="all"><option value="all">全部</option></select></label>
        </div>
      </div>

      <div className="archive-kpi-grid">
        {archiveStats.map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <strong>{String(item.value).padStart(2, '0')}<em>{item.unit}</em></strong>
          </article>
        ))}
      </div>

      <div className="archive-workspace">
        <div className="archive-table">
          <div className="archive-table-row archive-table-head">
            {archiveColumns.map((column) => <span key={column}>{column}</span>)}
          </div>
          <div className="archive-table-body">
            {archiveRecords.map((record) => (
              <article
                role="button"
                tabIndex={0}
                className={`archive-table-row${selectedArchive?.id === record.id ? ' selected' : ''}`}
                key={record.id}
                onClick={() => onSelect(record.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(record.id)
                  }
                }}
              >
                <span className="archive-no">{record.archiveNo}</span>
                <strong>{record.name}<small>{record.area}</small></strong>
                <span>{record.start}<small>{record.endTime.slice(11, 16)} 结束</small></span>
                <span>{record.duration}</span>
                <span>{record.detail.currentPoint} / {record.detail.pointTotal}</span>
                <span className={record.abnormalCount > 0 ? 'archive-danger' : 'archive-ok'}>{record.abnormalCount} 项</span>
                <TaskStatus status={record.reviewState} />
                <div className="row-actions">
                  <button type="button" onClick={(event) => { event.stopPropagation(); onSelect(record.id) }}>详情</button>
                  <button type="button" className="action-remote" onClick={(event) => { event.stopPropagation(); onReplay(record) }}>回放</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); onReport(record) }}>报告</button>
                </div>
              </article>
            ))}
          </div>
        </div>

        {selectedArchive && (
          <aside className="archive-trace-card">
            <div className="archive-trace-head">
              <span>PROCESS TRACE</span>
              <strong>{selectedArchive.name}</strong>
              <TaskStatus status={selectedArchive.status} />
            </div>
            <dl className="archive-trace-meta">
              <div><dt>执行机器人</dt><dd>{selectedArchive.robot}</dd></div>
              <div><dt>巡检区域</dt><dd>{selectedArchive.area}</dd></div>
              <div><dt>巡检时间</dt><dd>{selectedArchive.start} - {selectedArchive.endTime.slice(11, 16)}</dd></div>
              <div><dt>识别结果</dt><dd>{selectedArchive.resultCount} 项</dd></div>
            </dl>
            <div className="archive-mini-timeline">
              {selectedArchive.timeline.map((item) => (
                <article className={`timeline-${item.state}`} key={`${selectedArchive.id}-${item.time}-${item.type}`}>
                  <time>{item.time}</time>
                  <span>{item.type}</span>
                  <strong>{item.label}</strong>
                </article>
              ))}
            </div>
            <div className="archive-trace-actions">
              <button type="button" className="detail-button" onClick={() => onReplay(selectedArchive)}>3D过程回放</button>
              <button type="button" onClick={() => onShowAi(selectedArchive)}>查看AI记录</button>
            </div>
          </aside>
        )}
      </div>
    </section>
  )
}

function AiReviewView({ aiRecords, selectedTask, onSelectTask, onReview, onReplay }) {
  const selectedRecords = aiRecords.filter((record) => record.taskId === selectedTask.id)
  const focusedRecord = selectedRecords[0] || aiRecords[0]
  const aiStats = [
    { label: '识别记录', value: aiRecords.length, unit: '项' },
    { label: '异常/告警', value: aiRecords.filter((record) => record.status === '异常' || record.status === '告警').length, unit: '项' },
    { label: '待复核', value: aiRecords.filter((record) => record.reviewStatus === '待复核').length, unit: '项' },
    { label: '已闭环', value: aiRecords.filter((record) => ['确认异常', '标记误报', '无需复核'].includes(record.reviewStatus)).length, unit: '项' },
  ]

  return (
    <section className="console-panel archive-panel ai-review-panel">
      <div className="panel-heading archive-heading">
        <div>
          <h2>AI识别复核工作</h2>
          <p>按识别结果组织异常、低置信度和待复核记录，复核结论会回写同一份识别结果池</p>
        </div>
        <div className="task-filters archive-filters">
          <label>状态<select defaultValue="all"><option value="all">全部</option></select></label>
          <label>复核<select defaultValue="pending"><option value="pending">待复核优</option></select></label>
          <label>机器人<select defaultValue="all"><option value="all">全部</option></select></label>
        </div>
      </div>

      <div className="archive-kpi-grid">
        {aiStats.map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <strong>{String(item.value).padStart(2, '0')}<em>{item.unit}</em></strong>
          </article>
        ))}
      </div>

      <div className="ai-review-workspace">
        <div className="ai-record-table">
          <div className="ai-record-row ai-record-head">
            {aiColumns.map((column) => <span key={column}>{column}</span>)}
          </div>
          <div className="ai-record-body">
            {aiRecords.map((record) => (
              <article
                role="button"
                tabIndex={0}
                className={`ai-record-row${selectedTask.id === record.taskId ? ' selected' : ''}`}
                key={record.id}
                onClick={() => onSelectTask(record.taskId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectTask(record.taskId)
                  }
                }}
              >
                <strong>{record.targetName}<small>{record.recognitionType}</small></strong>
                <span>{record.taskName}<small>{record.pointName}</small></span>
                <span className={record.status === '异常' || record.status === '告警' ? 'archive-danger' : 'archive-ok'}>{record.value}</span>
                <span>{record.standardRange}</span>
                <span>{record.confidence}</span>
                <TaskStatus status={record.status} />
                <TaskStatus status={record.reviewStatus} />
                <div className="row-actions">
                  <button type="button" className="action-start" onClick={(event) => { event.stopPropagation(); onReview(record, '确认异常') }}>确认</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); onReview(record, '标记误报') }}>误报</button>
                  <button type="button" className="action-remote" onClick={(event) => { event.stopPropagation(); onReplay(record.taskId) }}>定位</button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="archive-trace-card ai-insight-card">
          <div className="archive-trace-head">
            <span>AI REVIEW DETAIL</span>
            <strong>{focusedRecord?.targetName || '暂无识别记录'}</strong>
            {focusedRecord && <TaskStatus status={focusedRecord.reviewStatus} />}
          </div>
          {focusedRecord && (
            <>
              <dl className="archive-trace-meta">
                <div><dt>关联任务</dt><dd>{focusedRecord.taskName}</dd></div>
                <div><dt>识别值</dt><dd>{focusedRecord.value}</dd></div>
                <div><dt>标准范围</dt><dd>{focusedRecord.standardRange}</dd></div>
                <div><dt>采集时间</dt><dd>{focusedRecord.capturedAt}</dd></div>
              </dl>
              <div className={`preview-visual visual-${focusedRecord.visual}`}>
                {focusedRecord.visual === 'meter' ? <span /> : <b>{focusedRecord.value}</b>}
              </div>
              <div className="archive-trace-actions">
                <button type="button" className="detail-button" onClick={() => onReview(focusedRecord, '确认异常')}>确认异常</button>
                <button type="button" onClick={() => onReview(focusedRecord, '标记误报')}>标记误报</button>
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  )
}

function ReportCenterView({ reportRecords, selectedTask, onSelect, onPreview, onReplay }) {
  const selectedReport = reportRecords.find((record) => record.id === selectedTask.id) || reportRecords[0]
  const reportStats = [
    { label: '报告档案', value: reportRecords.length, unit: '项' },
    { label: '已生成', value: reportRecords.filter((record) => record.reportStatus === '已生成').length, unit: '项' },
    { label: '待生成', value: reportRecords.filter((record) => record.reportStatus === '待生成').length, unit: '项' },
    { label: '待复核', value: reportRecords.filter((record) => record.reportStatus === '待复核').length, unit: '项' },
  ]

  return (
    <section className="console-panel archive-panel report-center-panel">
      <div className="panel-heading archive-heading">
        <div>
          <h2>巡检报告归档中心</h2>
          <p>基于历史巡检档案、AI 复核结论生成报告，用于预览、导出和归档</p>
        </div>
        <div className="task-filters archive-filters">
          <label>状态<select defaultValue="all"><option value="all">全部</option></select></label>
          <label>周期<select defaultValue="week"><option value="week">本周</option></select></label>
          <label>机器人<select defaultValue="all"><option value="all">全部</option></select></label>
        </div>
      </div>

      <div className="archive-kpi-grid">
        {reportStats.map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <strong>{String(item.value).padStart(2, '0')}<em>{item.unit}</em></strong>
          </article>
        ))}
      </div>

      <div className="report-workspace">
        <div className="report-table">
          <div className="report-table-row report-table-head">
            {reportColumns.map((column) => <span key={column}>{column}</span>)}
          </div>
          <div className="report-table-body">
            {reportRecords.map((record) => (
              <article
                role="button"
                tabIndex={0}
                className={`report-table-row${selectedReport?.id === record.id ? ' selected' : ''}`}
                key={record.reportNo}
                onClick={() => onSelect(record.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(record.id)
                  }
                }}
              >
                <span className="archive-no">{record.reportNo}</span>
                <strong>{record.name}<small>{record.area}</small></strong>
                <span>{record.start}<small>{record.endTime.slice(11, 16)} 结束</small></span>
                <span>{record.detail.currentPoint} / {record.detail.pointTotal}</span>
                <span className={record.abnormalCount > 0 ? 'archive-danger' : 'archive-ok'}>{record.abnormalCount} 项</span>
                <TaskStatus status={record.reviewState} />
                <TaskStatus status={record.reportStatus} />
                <div className="row-actions">
                  <button type="button" className="action-start" onClick={(event) => { event.stopPropagation(); onPreview(record) }}>预览</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); onPreview(record) }}>导出</button>
                  <button type="button" className="action-remote" onClick={(event) => { event.stopPropagation(); onReplay(record) }}>回放</button>
                </div>
              </article>
            ))}
          </div>
        </div>

        {selectedReport && (
          <aside className="archive-trace-card report-summary-card">
            <div className="archive-trace-head">
              <span>REPORT PACKAGE</span>
              <strong>{selectedReport.name}</strong>
              <TaskStatus status={selectedReport.reportStatus} />
            </div>
            <dl className="archive-trace-meta">
              <div><dt>报告编号</dt><dd>{selectedReport.reportNo}</dd></div>
              <div><dt>生成时间</dt><dd>{selectedReport.generatedAt}</dd></div>
              <div><dt>巡检用时</dt><dd>{selectedReport.duration}</dd></div>
              <div><dt>复核状态</dt><dd>{selectedReport.reviewState}</dd></div>
            </dl>
            <div className="report-progress-list">
              {['巡检档案', 'AI复核', '报告生成', '归档导出'].map((label, index) => (
                <article className={index < (selectedReport.reportStatus === '已生成' ? 4 : 2) ? 'done' : 'pending'} key={label}>
                  <span>{index + 1}</span>
                  <strong>{label}</strong>
                </article>
              ))}
            </div>
            <div className="archive-trace-actions">
              <button type="button" className="detail-button" onClick={() => onPreview(selectedReport)}>预览报告</button>
              <button type="button" onClick={() => onReplay(selectedReport)}>3D回放</button>
            </div>
          </aside>
        )}
      </div>
    </section>
  )
}

function PlanRoutePreview({
  pointIds = [],
  routePoints = [],
  mapData = hanlinRoomMap,
  selectable = false,
  onTogglePoint,
  onAddFreePoint,
  showRoute = true,
  showSlamMap = false,
  onToggleSlamMap,
}) {
  const mapPadding = Math.max(mapData.size.width, mapData.size.height) * 0.03
  const isSlamRouteMap = Boolean(mapData.slamMap)
  const mapPointById = Object.fromEntries(mapData.inspectionPoints.map((point) => [point.id, point]))
  const viewBox = [
    -mapPadding,
    -mapPadding,
    mapData.size.width + mapPadding * 2,
    mapData.size.height + mapPadding * 2,
  ].join(' ')
  const selectedRoutePoints = routePoints.length
    ? routePoints
    : pointIds
      .map((pointId) => mapPointById[pointId])
      .filter(Boolean)
  const selectedPointSet = new Set(pointIds)

  const pathPoints = selectedRoutePoints
    .map((point) => `${point.x},${point.y}`)
    .join(' ')
  const headingLength = Math.max(mapData.size.width, mapData.size.height) * 0.025

  const handleMapClick = (event) => {
    if (!isSlamRouteMap || !selectable || !onAddFreePoint) return
    const svg = event.currentTarget
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const cursor = point.matrixTransform(svg.getScreenCTM().inverse())
    if (isPointInsideSlamCoverage(cursor, mapData)) {
      onAddFreePoint({ x: cursor.x, y: cursor.y })
    }
  }

  const mapSvg = (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label="巡检点2D 路线预览"
      className={isSlamRouteMap ? 'slam-route-map' : undefined}
      onClick={handleMapClick}
    >
      {mapData.slamMap?.coverage && (
        <>
          {showSlamMap && (
            <image
              href={mapData.slamMap.imageUrl}
              x={mapData.slamMap.coverage.x}
              y={mapData.slamMap.coverage.y}
              width={mapData.slamMap.coverage.width}
              height={mapData.slamMap.coverage.depth}
              preserveAspectRatio="none"
              transform={[
                mapData.slamMap.transform?.flipX
                  ? `translate(${mapData.slamMap.coverage.x * 2 + mapData.slamMap.coverage.width} 0) scale(-1 1)`
                  : '',
                mapData.slamMap.transform?.flipY
                  ? `translate(0 ${mapData.slamMap.coverage.y * 2 + mapData.slamMap.coverage.depth}) scale(1 -1)`
                  : '',
              ].filter(Boolean).join(' ')}
              className="map-slam-image"
            />
          )}
          <rect
            x={mapData.slamMap.coverage.x}
            y={mapData.slamMap.coverage.y}
            width={mapData.slamMap.coverage.width}
            height={mapData.slamMap.coverage.depth}
            className="map-slam-coverage"
          />
        </>
      )}
      {mapData.landmarkLines.map((line) => (
        <rect
          key={line.id}
          x={line.x + (line.lineWidth || 0) / 2}
          y={line.y + (line.lineWidth || 0) / 2}
          width={line.width - (line.lineWidth || 0)}
          height={line.height - (line.lineWidth || 0)}
          style={{ '--landmark-width': line.lineWidth || 100 }}
          className="map-landmark"
        />
      ))}
      {mapData.cabinets.map((cabinet) => (
        <rect
          key={cabinet.id}
          x={cabinet.x}
          y={cabinet.y}
          width={cabinet.width}
          height={cabinet.depth}
          className={`map-cabinet map-${cabinet.type}`}
        />
      ))}
      {mapData.walls?.map((segment) => (
        <line
          key={segment.id}
          x1={segment.x1}
          y1={segment.y1}
          x2={segment.x2}
          y2={segment.y2}
          className="map-building-wall"
        />
      ))}
      {mapData.halls?.map((hall) => (
        <rect
          key={hall.id}
          x={hall.x}
          y={hall.y}
          width={hall.width}
          height={hall.depth}
          className="map-hall-area"
        />
      ))}
      {mapData.ramps?.map((ramp) => (
        <line
          key={ramp.id}
          x1={ramp.x1}
          y1={ramp.y1}
          x2={ramp.x2}
          y2={ramp.y2}
          className="map-ramp-strip"
          style={{ '--ramp-width': ramp.width }}
        />
      ))}
      {mapData.columns?.map((column) => (
        <rect
          key={column.id}
          x={column.x - column.sizeX / 2}
          y={column.y - column.sizeY / 2}
          width={column.sizeX}
          height={column.sizeY}
          className="map-plaza-column"
        />
      ))}
      {mapData.corridors?.map((segment) => (
        <line
          key={segment.id}
          x1={segment.x1}
          y1={segment.y1}
          x2={segment.x2}
          y2={segment.y2}
          className="map-corridor-strip"
          style={{ '--corridor-width': segment.width }}
        />
      ))}
      {showRoute && pathPoints && <polyline points={pathPoints} className="map-route-line" />}
      {!isSlamRouteMap && mapData.inspectionPoints.map((point) => {
        const isSelected = selectedPointSet.has(point.id)
        const selectedIndex = pointIds.indexOf(point.id)

        return (
          <g
            key={point.id}
            className={`map-point-hit${selectable ? ' selectable' : ''}`}
            onClick={selectable ? () => onTogglePoint(point.id) : undefined}
          >
            <circle
              cx={point.x}
              cy={point.y}
              r={isSelected ? (selectedIndex === 0 ? 170 : 125) : 90}
              className={`${isSelected ? 'map-point selected' : 'map-point'}${selectedIndex === 0 ? ' start' : ''}`}
            />
            {isSelected && (
              <text x={point.x + 190} y={point.y - 150}>{selectedIndex + 1}</text>
            )}
          </g>
        )
      })}
      {isSlamRouteMap && selectedRoutePoints.map((point, index) => (
        <g
          key={point.id}
          className="map-free-point-hit"
          onClick={(event) => event.stopPropagation()}
        >
          <circle
            cx={point.x}
            cy={point.y}
            r={index === 0 ? 210 : 155}
            className={`map-point selected${index === 0 ? ' start' : ''}`}
          />
          <text x={point.x + 260} y={point.y - 210}>{index + 1}</text>
        </g>
      ))}
      {selectedRoutePoints.map((point) => {
        const vector = DIRECTION_VECTORS[getPlanPointDirection(point)]
        const tipX = point.x + vector.x * headingLength
        const tipY = point.y + vector.y * headingLength
        const baseX = point.x + vector.x * headingLength * 0.66
        const baseY = point.y + vector.y * headingLength * 0.66
        const perpendicularX = -vector.y
        const perpendicularY = vector.x
        const wingSize = headingLength * 0.18

        return (
          <g key={`heading-${point.id}`} className="map-point-heading" aria-label={`到点朝向${getPlanPointDirection(point)}`}>
            <line x1={point.x} y1={point.y} x2={tipX} y2={tipY} />
            <polygon points={[
              `${tipX},${tipY}`,
              `${baseX + perpendicularX * wingSize},${baseY + perpendicularY * wingSize}`,
              `${baseX - perpendicularX * wingSize},${baseY - perpendicularY * wingSize}`,
            ].join(' ')} />
          </g>
        )
      })}
    </svg>
  )

  return (
    <div className="route-preview">
      <div className="route-preview-head">
        <strong>{mapData.name}</strong>
        <span>{selectedRoutePoints.length} 个巡检点 / 黄线为地标，黄箭头为到点朝向</span>
      </div>
      <div className="route-map-canvas">{mapSvg}</div>
      {isSlamRouteMap && (
        <div className="route-preview-footer">
          <label className="route-map-toggle">
            <input
              type="checkbox"
              checked={showSlamMap}
              onChange={(event) => onToggleSlamMap?.(event.target.checked)}
            />
            <span>显示 SLAM</span>
          </label>
        </div>
      )}
    </div>
  )
}

function ClusterControl() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('plan')
  const [taskList, setTaskList] = useState(initialTasks)
  const [selectedTaskId, setSelectedTaskId] = useState(initialTasks[0].id)
  const [actionNotice, setActionNotice] = useState('点击任务行查看执行详情，或使用右侧操作推进任务状态。')
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false)
  const [planForm, setPlanForm] = useState(defaultPlanForm)
  const [planStep, setPlanStep] = useState(1)
  const [showSlamMap, setShowSlamMap] = useState(false)
  const [storedResults, setStoredResults] = useState(() => getInspectionResults())
  const activePlanMap = getSceneMap(planForm.sceneId)

  useEffect(() => {
    let cancelled = false

    fetchSavedTasks()
      .then((savedTasks) => {
        if (cancelled || savedTasks.length === 0) return
        setTaskList((currentTasks) => {
          const savedIds = new Set(savedTasks.map((task) => task.id))
          return [
            ...savedTasks,
            ...currentTasks.filter((task) => !savedIds.has(task.id)),
          ]
        })
        setSelectedTaskId(savedTasks[0].id)
      })
      .catch((error) => {
        console.warn('load saved tasks failed', error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const activeTabMeta = useMemo(
    () => tabs.find((tab) => tab.id === activeTab) || tabs[0],
    [activeTab],
  )
  const statCards = useMemo(() => getTaskStats(taskList), [taskList])
  const selectedTask = useMemo(
    () => taskList.find((task) => task.id === selectedTaskId) || taskList[0],
    [selectedTaskId, taskList],
  )
  const selectedTaskResults = useMemo(() => (
    storedResults.filter((result) => result.taskId === selectedTask.id).slice(0, 3)
  ), [selectedTask.id, storedResults])
  const aiPreviewItems = selectedTaskResults.length > 0
    ? selectedTaskResults.map(mapStoredResultToPreview)
    : selectedTask.aiPreview
  const archiveRecords = useMemo(() => (
    taskList
      .filter((task) => ['已完成', '异常', '待审核'].includes(task.status))
      .map((task) => buildArchiveRecord(task, storedResults))
  ), [taskList, storedResults])
  const aiRecords = useMemo(() => buildAiRecords(taskList, storedResults), [taskList, storedResults])
  const reportRecords = useMemo(() => buildReportRecords(archiveRecords), [archiveRecords])
  const selectedArchiveRecord = useMemo(() => (
    archiveRecords.find((record) => record.id === selectedTask.id)
  ), [archiveRecords, selectedTask.id])
  const contextTask = activeTab === 'records' && selectedArchiveRecord ? selectedArchiveRecord : selectedTask
  const contextAiItems = activeTab === 'records' && selectedArchiveRecord
    ? (selectedTaskResults.length > 0 ? selectedTaskResults.map(mapStoredResultToPreview) : selectedArchiveRecord.aiPreview)
    : aiPreviewItems
  const contextPanel = useMemo(() => {
    if (activeTab === 'records') {
      return {
        detailTitle: '档案详情',
        progressLabel: '归档进度',
        timelineTitle: '过程追溯时间项',
        aiTitle: '归档识别结果',
        primaryAction: '3D过程回放',
        moreAction: '查看AI记录',
        actionTitle: '档案操作',
      }
    }

    if (activeTab === 'ai') {
      return {
        detailTitle: '识别任务详情',
        progressLabel: '复核进度',
        timelineTitle: '关联巡检时间项',
        aiTitle: 'AI识别复核队列',
        primaryAction: '查看异常详情',
        moreAction: '查看复核结果',
        actionTitle: '复核操作',
      }
    }

    if (activeTab === 'report') {
      return {
        detailTitle: '报告归档详情',
        progressLabel: '报告进度',
        timelineTitle: '报告生成链路',
        aiTitle: '报告识别摘要',
        primaryAction: '生成报告',
        moreAction: '查看报告记录',
        actionTitle: '报告操作',
      }
    }

    return {
      detailTitle: '当前任务详情',
      progressLabel: '任务进度',
      timelineTitle: '巡检执行时间项',
      aiTitle: 'AI识别结果预览',
      primaryAction: '实时监控',
      moreAction: '查看更多',
      actionTitle: '快捷模板',
    }
  }, [activeTab])

  useEffect(() => subscribeInspectionResults(setStoredResults), [])

  useEffect(() => {
    if (activeTab !== 'records' || archiveRecords.length === 0) {
      return
    }

    if (!archiveRecords.some((record) => record.id === selectedTaskId)) {
      setSelectedTaskId(archiveRecords[0].id)
    }
  }, [activeTab, archiveRecords, selectedTaskId])

  useEffect(() => {
    if (activeTab !== 'ai' || aiRecords.length === 0) {
      return
    }

    if (!aiRecords.some((record) => record.taskId === selectedTaskId)) {
      setSelectedTaskId(aiRecords[0].taskId)
    }
  }, [activeTab, aiRecords, selectedTaskId])

  useEffect(() => {
    if (activeTab !== 'report' || reportRecords.length === 0) {
      return
    }

    if (!reportRecords.some((record) => record.id === selectedTaskId)) {
      setSelectedTaskId(reportRecords[0].id)
    }
  }, [activeTab, reportRecords, selectedTaskId])

  const updateTask = (taskId, updater, notice) => {
    setSelectedTaskId(taskId)
    setTaskList((currentTasks) => currentTasks.map((task) => (
      task.id === taskId ? updater(task) : task
    )))
    setActionNotice(notice)
  }

  const handleDeleteTask = async (event, task) => {
    event.stopPropagation()

    try {
      if (task.source !== 'demo') {
        await deleteSavedTask(task.id)
      }

      setTaskList((currentTasks) => {
        const nextTasks = currentTasks.filter((item) => item.id !== task.id)
        setSelectedTaskId((currentId) => (currentId === task.id ? nextTasks[0]?.id : currentId))
        return nextTasks
      })
      setActionNotice(`${task.name} 已删除。`)
    } catch (error) {
      setSelectedTaskId(task.id)
      setActionNotice(`${task.name} 删除失败：${error.message}`)
    }
  }

  const openPlanModal = (areaTemplate) => {
    if (areaTemplate) {
      setPlanForm(getAreaForm(areaTemplate))
    } else {
      setPlanForm(defaultPlanForm)
    }

    setPlanStep(1)
    setShowSlamMap(false)
    setIsPlanModalOpen(true)
  }

  const updatePlanForm = (field, value) => {
    setPlanForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
  }

  const changePlanScene = (sceneId) => {
    const mapData = getSceneMap(sceneId)
    const isLabScene = sceneId === 'lab-building'

    setPlanForm((currentForm) => ({
      ...currentForm,
      sceneId,
      roomId: mapData.id,
      areaId: wholeRoomScope.id,
      area: isLabScene ? `${mapData.name} / 环形走廊` : `${mapData.name} / 整房巡检`,
      name: isLabScene ? `${mapData.name}环廊巡检任务` : `${mapData.name}整房巡检任务`,
      selectedPointIds: getNavigablePointIds(sceneId),
      routePoints: [],
      pointDirections: {},
    }))
  }

  const togglePlanPoint = (pointId) => {
    setPlanForm((currentForm) => {
      const hasPoint = currentForm.selectedPointIds.includes(pointId)
      return {
        ...currentForm,
        selectedPointIds: hasPoint
          ? currentForm.selectedPointIds.filter((item) => item !== pointId)
          : [...currentForm.selectedPointIds, pointId],
      }
    })
  }

  const movePlanPoint = (pointId, direction) => {
    setPlanForm((currentForm) => {
      const index = currentForm.selectedPointIds.indexOf(pointId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= currentForm.selectedPointIds.length) {
        return currentForm
      }

      const selectedPointIds = [...currentForm.selectedPointIds]
      const [point] = selectedPointIds.splice(index, 1)
      selectedPointIds.splice(nextIndex, 0, point)
      return { ...currentForm, selectedPointIds }
    })
  }

  const addFreeRoutePoint = (coords) => {
    setPlanForm((currentForm) => {
      const nextIndex = (currentForm.routePoints?.length || 0) + 1
      const point = {
        id: `LAB-FREE-${String(nextIndex).padStart(3, '0')}-${Date.now()}`,
        name: `自由点${nextIndex}`,
        targetName: `自由点${nextIndex}`,
        x: Math.round(coords.x),
        y: Math.round(coords.y),
        direction: 'east',
        yaw: 'east',
        recognitionTargets: ['导航点'],
        temporary: true,
      }

      return {
        ...currentForm,
        routePoints: [...(currentForm.routePoints || []), point],
      }
    })
  }

  const removeFreeRoutePoint = (pointId) => {
    setPlanForm((currentForm) => ({
      ...currentForm,
      routePoints: (currentForm.routePoints || []).filter((point) => point.id !== pointId),
    }))
  }

  const updatePlanPointDirection = (pointId, direction) => {
    const normalizedDirection = normalizeArrivalDirection(direction)
    setPlanForm((currentForm) => ({
      ...currentForm,
      pointDirections: {
        ...(currentForm.pointDirections || {}),
        [pointId]: normalizedDirection,
      },
      routePoints: (currentForm.routePoints || []).map((point) => (
        point.id === pointId
          ? { ...point, direction: normalizedDirection, yaw: normalizedDirection }
          : point
      )),
    }))
  }

  const moveFreeRoutePoint = (pointId, direction) => {
    setPlanForm((currentForm) => {
      const routePoints = [...(currentForm.routePoints || [])]
      const index = routePoints.findIndex((point) => point.id === pointId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= routePoints.length) {
        return currentForm
      }

      const [point] = routePoints.splice(index, 1)
      routePoints.splice(nextIndex, 0, point)
      return { ...currentForm, routePoints }
    })
  }

  const reversePlanRoute = () => {
    setPlanForm((currentForm) => ({
      ...currentForm,
      selectedPointIds: [...currentForm.selectedPointIds].reverse(),
      routePoints: [...(currentForm.routePoints || [])].reverse(),
    }))
  }

  const handleCreatePlan = async (event) => {
    event.preventDefault()
    const selectedCount = planForm.sceneId === 'lab-building'
      ? (planForm.routePoints?.length || 0)
      : planForm.selectedPointIds.length
    if (selectedCount === 0) {
      setActionNotice('请至少选择 1 个巡检点后再创建任务。')
      setPlanStep(2)
      return
    }

    const newTask = createTaskFromForm(planForm)
    let savedTask

    try {
      savedTask = await saveTask(newTask)
    } catch (error) {
      console.error('save task failed', error)
      setActionNotice(`任务保存失败：${error.message}`)
      return
    }

    setTaskList((currentTasks) => [savedTask, ...currentTasks.filter((task) => task.id !== savedTask.id)])
    setSelectedTaskId(savedTask.id)
    setActiveTab('plan')
    setIsPlanModalOpen(false)
    setPlanStep(1)
    setActionNotice(`${newTask.name} 已创建，状态为待执行，可直接点击“开始”。`)
  }

  const sendTaskNavigationRoute = async (task) => {
    const mapData = getSceneMap(task.sceneId)
    const sourceGoals = task.routePoints?.length
      ? buildNavigationGoalsFromPoints(task.routePoints, mapData)
      : buildNavigationGoals(task.pointIds || [], mapData)
    const goals = sourceGoals.map((goal) => ({
      ...goal,
      task_id: task.id,
      speed: NAVIGATION_SPEED,
    }))
    if (goals.length === 0) {
      throw new Error('no navigation points selected')
    }

    const response = await fetch('/api/vehicle/navigation-route', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicle_id: task.robot,
        task_id: task.id,
        speed: NAVIGATION_SPEED,
        goals,
      }),
    })
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.detail || 'navigation route request failed')
    }

    return { goals, data }
  }

  const handleTaskAction = async (event, task, action) => {
    event.stopPropagation()

    if (action === 'start' || action === 'resume') {
      try {
        const { goals, data } = await sendTaskNavigationRoute(task)
        const firstGoal = goals[0]
        const executionId = getNavigationExecutionId(data)
        savePatrolMonitorContext({
          executionId,
          taskId: task.id,
          taskName: task.name,
          sceneId: task.sceneId,
          robot: task.robot,
          pointIds: task.pointIds,
          routePoints: task.routePoints,
          navigationGoals: goals,
        })
        updateTask(
          task.id,
          getStartedTask,
          `${task.name} sent to ${task.robot}: ${goals.length} goals, execution ${executionId || 'unknown'}, first ${firstGoal.point_id} -> map(${firstGoal.x}, ${firstGoal.y}, yaw ${firstGoal.yaw})`,
        )
        setActiveTab('plan')
      } catch (error) {
        setSelectedTaskId(task.id)
        setActionNotice(`${task.name} navigation failed: ${error.message}`)
      }
      return
    }

    if (action === 'pause') {
      try {
        const response = await fetch(`/api/vehicle/stop?vehicle_id=${encodeURIComponent(task.robot)}`, {
          method: 'POST',
          credentials: 'include',
        })
        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(data.detail || 'vehicle stop request failed')
        }

        updateTask(task.id, getPausedTask, `${task.name} 暂停成功，可重新开始或取消。`)
        setActiveTab('plan')
      } catch (error) {
        setSelectedTaskId(task.id)
        setActionNotice(`${task.name} 暂停失败：${error.message}`)
      }
      return
    }
    if (action === 'remote') {
      setSelectedTaskId(task.id)
      setActionNotice(`正在进入遥控台：${task.robot} / ${task.name}`)
      navigate('/device-control', { state: { taskId: task.id, robot: task.robot, taskName: task.name } })
      return
    }

    if (action === 'inspect') {
      setSelectedTaskId(task.id)
      setActiveTab('ai')
      setActionNotice(`${task.name} 的异常识别结果已聚焦到下、AI 预览。`)
      return
    }

    if (action === 'review') {
      updateTask(task.id, getReviewedTask, `${task.name} 已提交人工复核，状态更新为待审核。`)
      setActiveTab('ai')
      return
    }

    if (action === 'record') {
      setSelectedTaskId(task.id)
      setActiveTab('records')
      setActionNotice(`正在查看 ${task.name} 的历史巡检记录。`)
      return
    }

    if (action === 'report') {
      setSelectedTaskId(task.id)
      setActiveTab('report')
      setActionNotice(`${task.name} 已进入报告生成流程。`)
    }
  }

  const openPatrolReplay = (task) => {
    setSelectedTaskId(task.id)
    navigate(buildPatrolMonitorUrl({ taskId: task.id, vehicleId: task.robot, replayMode: true }), {
      state: {
        taskId: task.id,
        taskName: task.name,
        sceneId: task.sceneId,
        robot: task.robot,
        pointIds: task.pointIds,
        routePoints: task.routePoints,
        replayMode: true,
      },
    })
  }

  const openLivePatrolMonitor = (task) => {
    const monitor = loadPatrolMonitorContext({ taskId: task.id })
    const state = {
      taskId: task.id,
      taskName: task.name,
      sceneId: task.sceneId,
      robot: task.robot,
      pointIds: task.pointIds,
      routePoints: task.routePoints,
      ...monitor,
      replayMode: false,
    }
    navigate(buildPatrolMonitorUrl({
      executionId: state.executionId,
      vehicleId: state.robot,
      taskId: state.taskId,
    }), { state })
  }

  const showArchiveAiRecords = (task) => {
    setSelectedTaskId(task.id)
    setActiveTab('ai')
    setActionNotice(`${task.name} 的历、AI 识别记录已聚焦。`)
  }

  const showArchiveReport = (task) => {
    setSelectedTaskId(task.id)
    setActiveTab('report')
    setActionNotice(`${task.name} 的历史巡检报告已打开归档入口。`)
  }

  const openReplayByTaskId = (taskId) => {
    const task = getTaskById(taskList, taskId)
    openPatrolReplay(task)
  }

  const handleAiReview = (record, reviewStatus) => {
    setSelectedTaskId(record.taskId)

    if (record.source === 'stored') {
      setStoredResults(updateInspectionResultReview(record.id, reviewStatus))
    }

    setActionNotice(`${record.targetName} 已更新复核结论：${reviewStatus}。`)
  }

  const handleReportPreview = (record) => {
    setSelectedTaskId(record.id)
    setActionNotice(`${record.name} 的巡检报告已进入预览导出流程。`)
  }

  const handleContextPrimaryAction = () => {
    if (activeTab === 'records') {
      openPatrolReplay(contextTask)
      return
    }

    if (activeTab === 'ai') {
      setActiveTab('ai')
      setActionNotice(`${contextTask.name} 、AI 识别详情已聚焦。`)
      return
    }

    if (activeTab === 'report') {
      showArchiveReport(contextTask)
      return
    }

    openLivePatrolMonitor(contextTask)
  }

  const handleContextMoreAction = () => {
    if (activeTab === 'records') {
      showArchiveAiRecords(contextTask)
      return
    }

    if (activeTab === 'report') {
      setActionNotice(`${contextTask.name} 的报告归档记录已聚焦。`)
      return
    }

    setActiveTab('ai')
    setActionNotice(`${contextTask.name} 、AI 识别结果已聚焦。`)
  }

  return (
    <section className="task-console-page">
      <header className="task-hero">
        <div className="task-hero-copy">
          <span className="task-kicker">PATROL TASK CENTER</span>
          <h1>巡检任务管理</h1>
          <p>围绕巡检计划、执行过程、识别结果和报告归档组织任务闭环</p>
        </div>
        <section className="task-stats hero-stats" aria-label="巡检任务概览">
          {statCards.map((card) => (
            <article className={`task-stat-card tone-${card.tone}`} key={card.label}>
              <div>
                <span>{card.label}</span>
                <strong>{card.value}<em>{card.unit}</em></strong>
              </div>
              <i>{card.icon}</i>
            </article>
          ))}
        </section>
        <div className="task-actions">
          <button type="button" className="console-action primary" onClick={() => openPlanModal()}><span>+</span>新建计划</button>
          <button type="button" className="console-action"><span></span>导出报告</button>
        </div>
      </header>

      <nav className="task-tabs" aria-label="巡检任务管理视图">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`task-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'routes' ? <RouteManagementPanel /> : <>
      <div className="task-workbench">
        <main className="task-left-zone">
          {activeTab === 'records' && (
            <PatrolArchiveView
              archiveRecords={archiveRecords}
              selectedTask={selectedTask}
              onSelect={setSelectedTaskId}
              onReplay={openPatrolReplay}
              onShowAi={showArchiveAiRecords}
              onReport={showArchiveReport}
            />
          )}

          {activeTab === 'ai' && (
            <AiReviewView
              aiRecords={aiRecords}
              selectedTask={selectedTask}
              onSelectTask={setSelectedTaskId}
              onReview={handleAiReview}
              onReplay={openReplayByTaskId}
            />
          )}

          {activeTab === 'report' && (
            <ReportCenterView
              reportRecords={reportRecords}
              selectedTask={selectedTask}
              onSelect={setSelectedTaskId}
              onPreview={handleReportPreview}
              onReplay={openPatrolReplay}
            />
          )}

          {activeTab === 'plan' && (
            <section className="console-panel task-list-panel">
              <div className="panel-heading">
                <h2>{activeTabMeta.label === '巡检计划' ? '任务列表' : activeTabMeta.label}</h2>
                <div className="task-filters">
                  <label>区域<select defaultValue="all"><option value="all">全部</option></select></label>
                  <label>状态<select defaultValue="all"><option value="all">全部</option></select></label>
                  <label>机器人<select defaultValue="all"><option value="all">全部</option></select></label>
                  <button type="button">刷新</button>
                </div>
              </div>
              <div className="task-action-notice">{actionNotice}</div>

              <div className="task-table">
                <div className="task-table-row task-table-head">
                  {taskColumns.map((column) => <span key={column}>{column}</span>)}
                </div>
                <div className="task-table-body">
                  {taskList.map((task) => (
                    <div
                      role="button"
                      tabIndex={0}
                      data-task-id={task.id}
                      className={`task-table-row${selectedTask.id === task.id ? ' selected' : ''}`}
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedTaskId(task.id)
                        }
                      }}
                    >
                      <strong><i />{task.name}</strong>
                      <span>{task.area}</span>
                      <span>{task.robot}</span>
                      <span>{task.start}</span>
                      <TaskStatus status={task.status} />
                      <ProgressBar value={task.progress} status={task.status} />
                      <div className="row-actions">
                        {task.status === '待执行' && (
                          <button type="button" className="action-start" onClick={(event) => handleTaskAction(event, task, 'start')}>开始</button>
                        )}
                        {task.status === '执行中' && (
                          <>
                            <button type="button" className="action-start" onClick={(event) => { event.stopPropagation(); openLivePatrolMonitor(task) }}>监控</button>
                            <button type="button" className="action-remote" onClick={(event) => handleTaskAction(event, task, 'remote')}>遥控</button>
                            <button type="button" onClick={(event) => handleTaskAction(event, task, 'pause')}>暂停</button>
                          </>
                        )}
                        {task.status === '异常' && (
                          <>
                            <button type="button" className="action-alarm" onClick={(event) => handleTaskAction(event, task, 'inspect')}>异常</button>
                            <button type="button" onClick={(event) => handleTaskAction(event, task, 'review')}>复核</button>
                          </>
                        )}
                        {task.status === '已完成' && (
                          <>
                            <button type="button" onClick={(event) => handleTaskAction(event, task, 'record')}>记录</button>
                            <button type="button" onClick={(event) => handleTaskAction(event, task, 'report')}>报告</button>
                          </>
                        )}
                        {task.status === '待审核' && (
                          <button type="button" className="action-start" onClick={(event) => handleTaskAction(event, task, 'resume')}>继续</button>
                        )}
                        <button type="button" className="action-delete" onClick={(event) => handleDeleteTask(event, task)}>删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </main>

        <aside className="task-side-zone">
          <section className="console-panel current-task-panel">
            <div className="panel-heading compact"><h2>{contextPanel.detailTitle}</h2></div>
            <div className="current-task-card">
              <div className="task-robot-photo">
                <span className="robot-lens" />
                <span className="robot-body" />
                <span className="robot-base" />
              </div>
              <div className="current-task-copy">
                <div className="task-title-line">
                  <strong>{contextTask.name}</strong>
                  <TaskStatus status={activeTab === 'records' && contextTask.reviewState ? contextTask.reviewState : contextTask.status} />
                </div>
                <dl>
                  <div><dt>执行机器人</dt><dd>{contextTask.robot}</dd></div>
                  <div><dt>{activeTab === 'records' ? '归档编号' : '巡检点总数'}</dt><dd>{activeTab === 'records' ? contextTask.archiveNo : `${contextTask.detail.pointTotal} 个`}</dd></div>
                  <div><dt>{activeTab === 'records' ? '完成点位' : '当前巡检点'}</dt><dd>{contextTask.detail.currentPoint} / {contextTask.detail.pointTotal}</dd></div>
                  <div><dt>异常数量</dt><dd>{contextTask.abnormalCount ?? contextTask.detail.abnormalCount} 项</dd></div>
                  <div><dt>{activeTab === 'records' ? '结束时间' : '预计完成时间'}</dt><dd>{activeTab === 'records' ? contextTask.endTime?.slice(11, 16) : contextTask.detail.eta}</dd></div>
                </dl>
              </div>
            </div>
            <div className="side-progress">
              <span>{contextPanel.progressLabel}</span>
              <i><b style={{ width: `${contextTask.progress}%` }} /></i>
              <strong>{contextTask.progress}%</strong>
            </div>
            <button
              type="button"
              className="detail-button"
              onClick={handleContextPrimaryAction}
            >
              {contextPanel.primaryAction}
            </button>
          </section>

          <section className="console-panel template-panel">
            <div className="panel-heading compact"><h2>{contextPanel.actionTitle}</h2></div>
            {activeTab === 'plan' ? (
              <div className="template-list">
                {routeTemplates.map((template) => (
                  <article className="template-item" key={template.name}>
                    <span></span>
                    <div><strong>{template.name}</strong><small>{template.meta}</small></div>
                    <button type="button" onClick={() => openPlanModal(template)}>使用</button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="template-list">
                <article className="template-item">
                  <span>3D</span>
                  <div><strong>{activeTab === 'records' ? '过程回放' : '关联过程'}</strong><small>{contextTask.name}</small></div>
                  <button
                    type="button"
                    onClick={() => (activeTab === 'records' ? openPatrolReplay(contextTask) : openLivePatrolMonitor(contextTask))}
                  >
                    {activeTab === 'records' ? '回放' : '监控'}
                  </button>
                </article>
                <article className="template-item">
                  <span>AI</span>
                  <div><strong>{activeTab === 'ai' ? '复核结果' : '识别记录'}</strong><small>{contextAiItems.length} 条识别结果</small></div>
                  <button type="button" onClick={handleContextMoreAction}>查看</button>
                </article>
                <article className="template-item">
                  <span>RP</span>
                  <div><strong>报告归档</strong><small>{contextTask.status === '已完成' ? '可生成报告' : '等待闭环'}</small></div>
                  <button type="button" onClick={() => showArchiveReport(contextTask)}>报告</button>
                </article>
              </div>
            )}
          </section>
        </aside>
      </div>

      <div className="task-bottom-zone">
        <section className="console-panel timeline-panel">
          <div className="panel-heading compact"><h2>{contextPanel.timelineTitle}</h2></div>
          <div className="execution-timeline">
            {contextTask.timeline.map((item) => (
              <article className={`timeline-node timeline-${item.state}`} key={`${contextTask.id}-${item.label}`}>
                <time>{item.time}</time>
                <span>{item.type}</span>
                <strong>{item.label}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="console-panel ai-preview-panel">
          <div className="panel-heading compact">
            <h2>{contextPanel.aiTitle}</h2>
            <button type="button" className="text-link" onClick={handleContextMoreAction}>{contextPanel.moreAction}</button>
          </div>
          <div className="ai-preview-list">
            {contextAiItems.map((item) => (
              <article className="ai-preview-card" key={item.title}>
                <div className={`preview-visual visual-${item.visual}`}>
                  {item.visual === 'meter' ? <span /> : <b>{item.value}</b>}
                </div>
                <div className="preview-copy">
                  <div><strong>{item.title}</strong><TaskStatus status={item.status} /></div>
                  <p>识别结果 <b>{item.value}</b></p>
                  <p>置信度<b>{item.confidence}</b></p>
                  <p>识别时间 <b>{item.time}</b></p>
                  {item.reviewStatus && <p>复核状态<b>{item.reviewStatus}</b></p>}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
      </>}

      {isPlanModalOpen && (
        <div className="task-modal-backdrop" role="presentation">
          <section className="task-plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-modal-title">
            <div className="modal-heading">
              <div>
                <span className="task-kicker">CREATE PATROL PLAN</span>
                <h2 id="plan-modal-title">新建巡检计划</h2>
              </div>
              <button type="button" className="modal-close" aria-label="关闭新建计划" onClick={() => setIsPlanModalOpen(false)}>×</button>
            </div>

            <form className="plan-form" onSubmit={handleCreatePlan}>
              <div className="plan-stepper">
                {['巡检范围', '点位与路线'].map((label, index) => (
                  <button
                    type="button"
                    className={planStep === index + 1 ? 'active' : ''}
                    key={label}
                    onClick={() => setPlanStep(index + 1)}
                  >
                    <span>{index + 1}</span>{label}
                  </button>
                ))}
              </div>

              {planStep === 1 && (
                <div className="plan-step-panel scope-step">
                  <div className="scene-selector" role="group" aria-label="巡检场景">
                    <button
                      type="button"
                      className={planForm.sceneId === 'lab-building' ? 'active' : ''}
                      onClick={() => changePlanScene('lab-building')}
                    >
                      <span>实验楼一</span>
                      <small>导航联调场景 / 4.05m 走廊基准</small>
                    </button>
                    <button
                      type="button"
                      className={planForm.sceneId === 'power-room' ? 'active' : ''}
                      onClick={() => changePlanScene('power-room')}
                    >
                      <span>瀚林1号电</span>
                      <small>正式电房场景 / 50 个设备点</small>
                    </button>
                  </div>
                  <section className="scope-overview">
                    <div className="scope-title">
                      <div>
                        <span>巡检对象</span>
                        <strong>{activePlanMap.name}</strong>
                      </div>
                      <b>{planForm.sceneId === 'lab-building' ? '实验楼导航联动' : '整房单车巡检'}</b>
                    </div>
                    {planForm.sceneId === 'lab-building' ? (
                      <LabBuilding3DPreview mapData={activePlanMap} selectedPointIds={planForm.selectedPointIds} showPoints={false} />
                    ) : (
                      <PlanRoutePreview pointIds={getAreaPointIds('power-room')} mapData={activePlanMap} showRoute={false} />
                    )}
                    <div className="scope-metrics">
                      <article>
                        <span>固定点位</span>
                        <strong>{activePlanMap.inspectionPoints.length}</strong>
                      </article>
                      <article>
                        <span>巡检方式</span>
                        <strong>{planForm.sceneId === 'lab-building' ? '环廊巡检' : '整房巡检'}</strong>
                      </article>
                      <article>
                        <span>{planForm.sceneId === 'lab-building' ? '走廊基准' : '地标线'}</span>
                        <strong>{planForm.sceneId === 'lab-building' ? '4.05 m' : '黄色线'}</strong>
                      </article>
                      <article>
                        <span>默认车辆</span>
                        <strong>{wholeRoomScope.robot}</strong>
                      </article>
                    </div>
                  </section>

                  <section className="plan-config-panel">
                    <div className="config-panel-head">
                      <span>任务参数</span>
                      <strong>本次任务覆盖{activePlanMap.name}</strong>
                    </div>
                    <label>
                      <span>任务名称</span>
                      <input value={planForm.name} onChange={(event) => updatePlanForm('name', event.target.value)} />
                    </label>
                    <label>
                      <span>执行机器人</span>
                      <select value={planForm.robot} onChange={(event) => updatePlanForm('robot', event.target.value)}>
                        <option>nano1</option>
                        <option>nano2</option>
                        <option>nano3</option>
                      </select>
                    </label>
                    <div className="config-grid">
                      <label>
                        <span>开始日</span>
                        <input type="date" value={planForm.startDate} onChange={(event) => updatePlanForm('startDate', event.target.value)} />
                      </label>
                      <label>
                        <span>开始时间</span>
                        <input type="time" value={planForm.startTime} onChange={(event) => updatePlanForm('startTime', event.target.value)} />
                      </label>
                    </div>
                    <label>
                      <span>任务优先</span>
                      <select value={planForm.priority} onChange={(event) => updatePlanForm('priority', event.target.value)}>
                        <option></option>
                        <option></option>
                        <option></option>
                        <option>紧急</option>
                      </select>
                    </label>
                    <div className="scope-note">
                      场景切换会同步更新地图、固定点位、路线与识别目标；下一步确认本次需要执行的点位。
                    </div>
                  </section>

                  <div className="plan-step-note">
                    当前 first_floor 导航图只覆盖实验楼左半区；本阶段先对齐左半区 2D/3D 坐标，右半区后续完整建图后再校准。
                  </div>
                </div>
              )}

              {planStep === 2 && (
                <div className="plan-step-panel route-compose-step">
                  <PlanRoutePreview
                    pointIds={planForm.selectedPointIds}
                    routePoints={getPlanRoutePoints(planForm)}
                    mapData={activePlanMap}
                    selectable
                    onTogglePoint={togglePlanPoint}
                    onAddFreePoint={planForm.sceneId === 'lab-building' ? addFreeRoutePoint : undefined}
                    showSlamMap={showSlamMap}
                    onToggleSlamMap={setShowSlamMap}
                  />
                  <aside className="route-compose-panel">
                    <div className="route-order-panel">
                      <div className="route-order-head">
                        <div>
                          <strong>路线顺序</strong>
                          <span>{planForm.sceneId === 'lab-building' ? (planForm.routePoints?.length || 0) : planForm.selectedPointIds.length} 个已选点</span>
                        </div>
                        <button type="button" onClick={reversePlanRoute}>反向执行</button>
                      </div>
                      <div className="route-order-list">
                        {(planForm.sceneId === 'lab-building' ? (planForm.routePoints || []) : planForm.selectedPointIds).map((item, index) => {
                          const point = planForm.sceneId === 'lab-building' ? item : allInspectionPointById[item]
                          const pointId = point.id
                          const arrivalDirection = getPlanPointDirection(point, planForm.pointDirections)

                          return (
                            <article key={pointId}>
                              <span>{String(index + 1).padStart(2, '0')}</span>
                              <strong>{point.targetName}</strong>
                              <small>{planForm.sceneId === 'lab-building' ? `x ${point.x} / y ${point.y}` : point.name}</small>
                              <label className="route-direction-control">
                                <span>到点朝向</span>
                                <select
                                  aria-label={`${point.targetName}到点朝向`}
                                  value={arrivalDirection}
                                  onChange={(event) => updatePlanPointDirection(pointId, event.target.value)}
                                >
                                  {ARRIVAL_DIRECTIONS.map((direction) => (
                                    <option key={direction.value} value={direction.value}>{direction.label}</option>
                                  ))}
                                </select>
                              </label>
                              <div className="route-order-actions">
                                <button type="button" onClick={() => (planForm.sceneId === 'lab-building' ? moveFreeRoutePoint(pointId, -1) : movePlanPoint(pointId, -1))}>上移</button>
                                <button type="button" onClick={() => (planForm.sceneId === 'lab-building' ? moveFreeRoutePoint(pointId, 1) : movePlanPoint(pointId, 1))}>下移</button>
                                <button
                                  type="button"
                                  className="route-delete-button"
                                  onClick={() => (
                                    planForm.sceneId === 'lab-building'
                                      ? removeFreeRoutePoint(pointId)
                                      : togglePlanPoint(pointId)
                                  )}
                                >
                                  删除
                                </button>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    </div>

                    {planForm.sceneId !== 'lab-building' ? (
                    <div className="fixed-point-panel">
                      <div className="fixed-point-head">
                        <strong>固定点位</strong>
                        <span>点击点位可加入或移出路线</span>
                      </div>
                      <div className="fixed-point-list">
                        {getAreaPointIds(planForm.sceneId).map((pointId) => {
                          const point = allInspectionPointById[pointId]
                          const checked = planForm.selectedPointIds.includes(pointId)

                          return (
                            <button
                              type="button"
                              className={checked ? 'selected' : ''}
                              key={pointId}
                              onClick={() => togglePlanPoint(pointId)}
                            >
                              <strong>{point.targetName}</strong>
                              <span>{point.recognitionTargets.slice(0, 2).join(' / ')}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    ) : (
                    <div className="fixed-point-panel">
                      <div className="fixed-point-head">
                        <strong>自由选点</strong>
                        <span>点击左侧地图添加路线</span>
                      </div>
                      <div className="free-point-help">
                        <strong>当前以 3D/SLAM 对齐后的覆盖区为准</strong>
                        <span>只在绿色边框内点击，点位会按点击顺序下发给 nano1</span>
                        <button type="button" onClick={() => updatePlanForm('routePoints', [])}>清空路线</button>
                      </div>
                    </div>
                    )}
                  </aside>
                  <div className="plan-step-note">
                    点位和路线在同一步完成：从固定点位库选择本次巡检点，再按右侧顺序微调执行路线。
                  </div>
                </div>
              )}

              <div className="plan-summary">
                <strong>{planForm.name || '未命名任务'}</strong>
                <span>{planForm.area} / {planForm.robot}</span>
                <span>
                  {planForm.sceneId === 'lab-building' ? (planForm.routePoints?.length || 0) : planForm.selectedPointIds.length}
                  {planForm.sceneId === 'lab-building' ? ' 个自由导航点' : ' 个固定巡检点'}
                  {' / '}{getEstimatedMinutes(planForm.sceneId === 'lab-building' ? (planForm.routePoints?.length || 0) : planForm.selectedPointIds.length)} 分钟 / {planForm.priority}优先级</span>
              </div>

              <div className="modal-actions">
                <button type="button" onClick={() => setIsPlanModalOpen(false)}>取消</button>
                {planStep > 1 && <button type="button" onClick={() => setPlanStep(planStep - 1)}>上一步</button>}
                {planStep < 2 && <button type="button" className="primary" onClick={() => setPlanStep(planStep + 1)}>下一步</button>}
                {planStep === 2 && <button type="submit" className="primary">创建任务</button>}
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}

export default ClusterControl
