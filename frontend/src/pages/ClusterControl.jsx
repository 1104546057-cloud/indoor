/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LabBuilding3DPreview from '../components/LabBuilding3DPreview'
import RouteManagementPanel from '../components/RouteManagementPanel'
import useBusinessOverview from '../hooks/useBusinessOverview'
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
const LIVE_NAVIGATION_LABELS = {
  idle: '等待路线',
  queued: '路线已接收',
  moving: '行驶中',
  arrived: '已到达点位',
  completed: '巡检完成',
  failed: '执行失败',
  cancelled: '已停止',
}

function getSceneMap(sceneId = 'power-room') {
  return sceneMaps[sceneId] || hanlinRoomMap
}

function quaternionToYaw(orientation) {
  if (!orientation || orientation.z === undefined || orientation.w === undefined) return null

  const x = Number(orientation.x || 0)
  const y = Number(orientation.y || 0)
  const z = Number(orientation.z)
  const w = Number(orientation.w)
  if (![x, y, z, w].every(Number.isFinite)) return null
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
}

function mapPoseToModelPoint(pose, mapData) {
  const slamMap = mapData?.slamMap
  if (!pose || !slamMap?.coverage || !slamMap?.imageSize || !slamMap?.yaml) return null

  const [originX, originY] = slamMap.yaml.origin
  const resolution = slamMap.yaml.resolution
  const pixelX = (pose.x - originX) / resolution
  const pixelY = slamMap.imageSize.height - ((pose.y - originY) / resolution)
  const normalizedX = slamMap.transform?.flipX ? 1 - (pixelX / slamMap.imageSize.width) : pixelX / slamMap.imageSize.width
  const normalizedY = slamMap.transform?.flipY ? 1 - (pixelY / slamMap.imageSize.height) : pixelY / slamMap.imageSize.height

  return {
    x: slamMap.coverage.x + normalizedX * slamMap.coverage.width,
    y: slamMap.coverage.y + normalizedY * slamMap.coverage.depth,
  }
}

function readVehiclePose(status, mapData) {
  const position = status?.pose?.position || status?.pose || status?.position || status?.odom?.pose?.pose?.position
  if (!position) return null

  const orientation = status?.orientation || status?.pose?.orientation || status?.odom?.pose?.pose?.orientation
  const yaw = status?.yaw ?? status?.theta ?? status?.pose?.yaw ?? orientation?.yaw ?? quaternionToYaw(orientation)
  const pose = {
    x: Number(position.x),
    y: Number(position.y),
    yaw: Number.isFinite(Number(yaw)) ? Number(yaw) : 0,
  }
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y)) return null

  const modelPoint = mapPoseToModelPoint(pose, mapData)
  return modelPoint ? { ...pose, modelPoint } : null
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
].map((task) => ({ ...task, source: 'demo' }))

const wholeRoomScope = {
  id: 'whole-room',
  name: '整房巡检范围',
  area: `${hanlinRoomMap.name} / 整房巡检`,
  robot: 'nano1',
  priority: '高',
}

const PLAN_PRIORITY_OPTIONS = ['低', '中', '高', '紧急']
const taskColumns = ['任务名称', '区域', '机器人', '开始时间', '状态', '进度', '操作']
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

function getPresetPlanRoutePoints(sceneId) {
  return getNavigablePointIds(sceneId)
    .map((pointId) => allInspectionPointById[pointId])
    .filter(Boolean)
    .map((point) => {
      const direction = getPlanPointDirection(point)
      return { ...point, direction, yaw: direction }
    })
}

const defaultLabRoutePoints = getPresetPlanRoutePoints('lab-building')

function getCurrentPlanSchedule(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')

  return {
    startDate: `${year}-${month}-${day}`,
    startTime: `${hour}:${minute}`,
  }
}

const defaultPlanForm = {
  name: '实验楼一层环廊巡检任务',
  sceneId: 'lab-building',
  roomId: labBuildingMap.id,
  areaId: wholeRoomScope.id,
  area: `${labBuildingMap.name} / 环形走廊`,
  robot: wholeRoomScope.robot,
  ...getCurrentPlanSchedule(),
  selectedPointIds: defaultLabRoutePoints.map((point) => point.id),
  routePoints: defaultLabRoutePoints,
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
    routeId: form.routeId || `custom-${form.areaId}`,
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

async function updateSavedTask(task) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(task),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'task update failed')
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

function getTaskPlanForm(task) {
  const sceneId = task.sceneId || 'lab-building'
  const mapData = getSceneMap(sceneId)
  const fallbackCount = task.detail?.pointTotal || mapData.inspectionPoints.length
  const sourcePoints = task.routePoints?.length
    ? task.routePoints
    : task.pointIds?.length
      ? task.pointIds.map((pointId) => allInspectionPointById[pointId]).filter(Boolean)
      : mapData.inspectionPoints.slice(0, fallbackCount)
  const routePoints = sourcePoints.map((point, index) => {
    const pointId = point.id || point.pointId || `${sceneId}-edit-${index + 1}`
    const direction = getPlanPointDirection(point)
    return {
      ...point,
      id: pointId,
      name: point.name || point.pointName || point.targetName || `巡检点${index + 1}`,
      targetName: point.targetName || point.name || point.pointName || `巡检点${index + 1}`,
      direction,
      yaw: direction,
    }
  })
  const [startDate = '', rawStartTime = ''] = String(task.start || '').split(' ')
  const schedule = getCurrentPlanSchedule()

  return {
    name: task.name || '未命名巡检任务',
    sceneId,
    roomId: mapData.id,
    areaId: task.routeId?.replace(/^custom-/, '') || wholeRoomScope.id,
    area: task.area || `${mapData.name} / 环形走廊`,
    robot: task.robot || wholeRoomScope.robot,
    routeId: task.routeId || `custom-${wholeRoomScope.id}`,
    startDate: startDate || schedule.startDate,
    startTime: rawStartTime.slice(0, 5) || schedule.startTime,
    selectedPointIds: routePoints.map((point) => point.id),
    routePoints,
    pointDirections: Object.fromEntries(
      routePoints.map((point) => [point.id, getPlanPointDirection(point)]),
    ),
    priority: task.priority || wholeRoomScope.priority,
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
    taskId: task.id,
    archiveNo: `ARC-${task.start.slice(2, 10).replaceAll('-', '')}-${task.robot.toUpperCase()}-${String(task.id).slice(-6).toUpperCase()}`,
    endTime: getTaskEndTime(task),
    duration: getArchiveDuration(task),
    routeName: task.routeName || task.area,
    failureReason: task.status === '异常' ? '任务异常中断，等待复核' : '',
    abnormalCount,
    reviewedCount,
    reviewState: abnormalCount === 0 ? '无需复核' : (reviewedCount >= abnormalCount ? '已复核' : '待复核'),
    resultCount: relatedResults.length || task.aiPreview.length,
    recognitionResults: relatedResults,
    images: relatedResults
      .filter((result) => result.imageUrl)
      .map((result, index) => ({
        id: result.imageId || `${task.id}-image-${index}`,
        fileUrl: result.imageUrl,
        pointId: result.pointId,
        capturedAt: result.capturedAt,
        imageType: result.imageType || 'visible',
      })),
    source: 'demo',
  }
}

const TERMINAL_RECORD_STATES = new Set(['completed', 'failed', 'cancelled', '已完成', '异常', '待审核'])
const RECORD_STATUS_LABELS = {
  completed: '已完成',
  success: '已完成',
  failed: '异常',
  cancelled: '待审核',
  interrupted: '异常',
}

function normalizeRecordStatus(status) {
  return RECORD_STATUS_LABELS[status] || status || '未知'
}

function formatArchiveDateTime(value, fallback = '--') {
  if (!value) return fallback
  return String(value).replace('T', ' ').slice(0, 19)
}

function formatNavigationEventTime(value) {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--:--'
  return new Date(timestamp * 1000).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatRealDuration(startValue, endValue) {
  if (!startValue || !endValue) return '未结束'
  const start = new Date(String(startValue).replace(' ', 'T'))
  const end = new Date(String(endValue).replace(' ', 'T'))
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000)
  if (!Number.isFinite(minutes) || minutes < 0) return '时间异常'
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`
  const hours = Math.floor(minutes / 60)
  const remain = minutes % 60
  return `${hours} 小时${remain ? ` ${remain} 分` : ''}`
}

function formatRecognitionConfidence(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  const percentage = numeric <= 1 ? numeric * 100 : numeric
  return `${percentage.toFixed(1)}%`
}

function mapBusinessResultToPreview(result) {
  const value = [result.value, result.unit].filter(Boolean).join(' ') || '--'
  return {
    id: result.id,
    pointId: result.pointId,
    targetName: result.targetName || result.itemCode || '未命名识别项',
    title: result.targetName || result.recognitionType || 'AI识别',
    recognitionType: result.recognitionType || 'AI识别',
    value,
    standardRange: result.standardRange || '未配置',
    confidence: formatRecognitionConfidence(result.confidence),
    capturedAt: formatArchiveDateTime(result.capturedAt),
    time: formatArchiveDateTime(result.capturedAt).slice(11, 19),
    status: result.status || '正常',
    reviewStatus: result.reviewStatus || '待复核',
    reviewRemark: result.reviewRemark,
    reviewedBy: result.reviewedBy,
    reviewedAt: formatArchiveDateTime(result.reviewedAt),
    imageUrl: result.imageUrl,
    visual: result.recognitionType?.includes('数显') ? 'digital' : 'meter',
  }
}

function normalizeArchiveRoutePoints(points, sceneId) {
  const mapData = getSceneMap(sceneId || 'lab-building')
  return (points || []).map((point, index) => {
    const x = Number(point.x)
    const y = Number(point.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null

    const appearsToBeRosMapPose = Boolean(mapData.slamMap) && Math.abs(x) < 1000 && Math.abs(y) < 1000
    const modelPoint = appearsToBeRosMapPose ? mapPoseToModelPoint({ x, y }, mapData) : { x, y }
    if (!modelPoint) return null
    return {
      ...point,
      id: point.id || `ARCHIVE-P${String(index + 1).padStart(2, '0')}`,
      name: point.name || point.targetName || `路线点 ${index + 1}`,
      targetName: point.targetName || point.name || `路线点 ${index + 1}`,
      x: modelPoint.x,
      y: modelPoint.y,
    }
  }).filter(Boolean)
}

function buildBusinessArchiveRecords(business, taskList) {
  const records = business?.records || []
  const results = business?.results || []
  const images = business?.images || []
  const taskById = Object.fromEntries(taskList.map((task) => [task.id, task]))

  return records
    .filter((record) => TERMINAL_RECORD_STATES.has(record.status))
    .map((record) => {
      const task = taskById[record.taskId] || {}
      const relatedResults = results
        .filter((result) => result.recordId === record.id || (!result.recordId && result.taskId === record.taskId))
        .map(mapBusinessResultToPreview)
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
      const relatedImages = images
        .filter((image) => image.recordId === record.id)
        .map((image) => ({
          ...image,
          fileUrl: image.fileUrl,
          capturedAt: formatArchiveDateTime(image.capturedAt),
        }))
      const imageKeys = new Set(relatedImages.map((image) => image.fileUrl))
      relatedResults.forEach((result, index) => {
        if (result.imageUrl && !imageKeys.has(result.imageUrl)) {
          relatedImages.push({
            id: `result-image-${record.id}-${index}`,
            fileUrl: result.imageUrl,
            pointId: result.pointId,
            capturedAt: result.capturedAt,
            imageType: 'recognition',
          })
          imageKeys.add(result.imageUrl)
        }
      })

      const status = normalizeRecordStatus(record.status)
      const pointTotal = Number(record.pointTotal || task.detail?.pointTotal || task.routePoints?.length || 0)
      const currentPoint = status === '已完成'
        ? pointTotal
        : Number(record.currentSequence || task.detail?.currentPoint || 0)
      const abnormalResults = relatedResults.filter((result) => ['异常', '告警'].includes(result.status))
      const reviewedCount = abnormalResults.filter((result) => result.reviewStatus && result.reviewStatus !== '待复核').length
      const abnormalCount = abnormalResults.length
      const reviewState = abnormalCount === 0 ? '无需复核' : reviewedCount >= abnormalCount ? '已复核' : '待复核'
      const startedAt = formatArchiveDateTime(record.startedAt || task.start)
      const finishedAt = formatArchiveDateTime(record.finishedAt, status === '已完成' ? startedAt : '--')
      const startTimeline = {
        time: startedAt.slice(11, 16),
        label: '任务开始执行',
        type: 'GO',
        state: 'done',
      }
      const resultTimeline = [...relatedResults]
        .reverse()
        .map((result) => ({
          time: result.time.slice(0, 5),
          label: `${result.targetName}：${result.value}`,
          type: ['异常', '告警'].includes(result.status) ? 'AL' : 'AI',
          state: ['异常', '告警'].includes(result.status) ? 'alarm' : 'done',
        }))
      const arrivalTimeline = (record.navigation?.results || [])
        .filter((result) => result.state === 'arrived')
        .map((result, index) => ({
          time: formatNavigationEventTime(result.finished_at),
          label: `到达 ${result.point_name || result.point_id || `巡检点 ${index + 1}`}`,
          type: 'POS',
          state: 'done',
        }))
      const captureTimeline = Object.values(record.captureEvents || {}).map((event) => ({
        time: formatArchiveDateTime(event.acceptedAt || event.failedAt || event.requestedAt).slice(11, 16),
        label: event.status === 'accepted'
          ? `${event.pointName || event.pointId || '巡检点'} 图片采集已受理`
          : `${event.pointName || event.pointId || '巡检点'} 图片采集失败`,
        type: event.status === 'accepted' ? 'IMG' : 'ERR',
        state: event.status === 'accepted' ? 'done' : 'alarm',
      }))
      const finishTimeline = {
        time: finishedAt === '--' ? '--:--' : finishedAt.slice(11, 16),
        label: status === '已完成' ? '巡检完成并归档' : record.failureReason || '任务中断',
        type: status === '已完成' ? 'END' : 'STOP',
        state: status === '已完成' ? 'done' : 'alarm',
      }
      const sceneId = record.taskSceneId || task.sceneId || 'lab-building'
      const routePoints = normalizeArchiveRoutePoints(
        record.routePoints?.length ? record.routePoints : (task.routePoints || []),
        sceneId,
      )

      return {
        ...task,
        id: `record-${record.id}`,
        recordId: record.id,
        taskId: record.taskId || task.id,
        archiveNo: record.recordCode || `REC-${record.id}`,
        name: record.taskName || task.name || '未命名巡检任务',
        area: record.taskArea || task.area || record.routeName || '未配置区域',
        sceneId,
        robot: record.robotName || task.robot || '未绑定',
        routeName: record.routeName || task.routeName || record.taskRouteId || '自定义路线',
        routePoints,
        pointIds: routePoints.map((point) => point.id).filter(Boolean),
        start: startedAt,
        endTime: finishedAt,
        duration: formatRealDuration(startedAt, finishedAt === '--' ? null : finishedAt),
        status,
        progress: Number(record.progress ?? (status === '已完成' ? 100 : 0)),
        detail: {
          pointTotal,
          currentPoint,
          eta: finishedAt === '--' ? '未结束' : finishedAt.slice(11, 16),
          abnormalCount,
        },
        abnormalCount,
        reviewedCount,
        reviewState,
        resultCount: relatedResults.length,
        recognitionResults: relatedResults,
        aiPreview: relatedResults.slice(0, 3),
        images: relatedImages,
        failureReason: record.failureReason || '',
        postExecution: record.postExecution || null,
        captureEvents: record.captureEvents || {},
        createdBy: record.createdBy || '系统',
        timeline: [startTimeline, ...arrivalTimeline, ...captureTimeline, ...resultTimeline, finishTimeline],
        source: 'business',
      }
    })
    .sort((a, b) => b.start.localeCompare(a.start))
}

function exportArchiveCsv(records) {
  const headers = ['档案编号', '任务名称', '区域', '机器人', '开始时间', '结束时间', '用时', '路线进度', '异常数量', '复核状态', '任务结论']
  const rows = records.map((record) => [
    record.archiveNo,
    record.name,
    record.area,
    record.robot,
    record.start,
    record.endTime,
    record.duration,
    `${record.detail.currentPoint}/${record.detail.pointTotal}`,
    record.abnormalCount,
    record.reviewState,
    record.status,
  ])
  const escapeCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `巡检档案-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function buildArchiveAiRecords(archiveRecords) {
  return archiveRecords.flatMap((archive) => (
    (archive.recognitionResults || []).map((result, index) => ({
      ...result,
      id: result.id || `${archive.id}-result-${index}`,
      source: archive.source === 'business' ? 'business' : 'stored',
      taskId: archive.taskId || archive.id,
      taskName: archive.name,
      area: archive.area,
      robot: archive.robot,
      targetName: result.targetName || result.title || '未命名识别项',
      recognitionType: result.recognitionType || 'AI识别',
      pointName: result.pointId || `P${String(index + 1).padStart(2, '0')}`,
      value: result.value || '--',
      standardRange: result.standardRange || '未配置',
      confidence: result.confidence || '--',
      capturedAt: result.capturedAt || result.time || '--',
      status: result.status || '正常',
      reviewStatus: result.reviewStatus || '待复核',
      visual: result.visual || 'digital',
    }))
  ))
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
      : (record.status === '异常' || record.postExecution?.reportReady === false ? '待生成' : '已生成')

    return {
      ...record,
      reportNo: `RPT-${String(record.archiveNo || record.id).replace(/^(ARC|REC)-?/, '')}`,
      reportStatus,
      generatedAt: reportStatus === '已生成' ? record.endTime : '--',
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

function PatrolArchiveView({
  archiveRecords,
  selectedArchiveId,
  onSelect,
  onReplay,
  onShowAi,
  onReport,
  loading,
  error,
  onReload,
}) {
  const [query, setQuery] = useState('')
  const [dateRange, setDateRange] = useState('all')
  const [conclusion, setConclusion] = useState('all')
  const [robot, setRobot] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)
  const [detailTab, setDetailTab] = useState('summary')
  const pageSize = 8
  const robots = useMemo(
    () => [...new Set(archiveRecords.map((record) => record.robot).filter(Boolean))].sort(),
    [archiveRecords],
  )
  const filteredRecords = useMemo(() => {
    const now = new Date()
    const startBoundary = new Date(now)
    if (dateRange === 'today') startBoundary.setHours(0, 0, 0, 0)
    if (dateRange === '7d') startBoundary.setDate(now.getDate() - 7)
    if (dateRange === '30d') startBoundary.setDate(now.getDate() - 30)
    const normalizedQuery = query.trim().toLowerCase()

    return archiveRecords
      .filter((record) => {
        const searchable = [
          record.archiveNo,
          record.name,
          record.area,
          record.routeName,
          record.robot,
          record.failureReason,
        ].join(' ').toLowerCase()
        if (normalizedQuery && !searchable.includes(normalizedQuery)) return false
        if (dateRange !== 'all') {
          const startedAt = new Date(String(record.start).replace(' ', 'T'))
          if (!Number.isFinite(startedAt.getTime()) || startedAt < startBoundary) return false
        }
        if (robot !== 'all' && record.robot !== robot) return false
        if (conclusion === 'completed' && record.status !== '已完成') return false
        if (conclusion === 'abnormal' && record.abnormalCount === 0 && record.status !== '异常') return false
        if (conclusion === 'interrupted' && !['异常', '待审核'].includes(record.status)) return false
        if (conclusion === 'pending' && record.reviewState !== '待复核') return false
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'oldest') return a.start.localeCompare(b.start)
        if (sortBy === 'abnormal') return b.abnormalCount - a.abnormalCount || b.start.localeCompare(a.start)
        return b.start.localeCompare(a.start)
      })
  }, [archiveRecords, conclusion, dateRange, query, robot, sortBy])
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRecords = filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize)
  const selectedArchive = filteredRecords.find((record) => record.id === selectedArchiveId) || filteredRecords[0] || null
  const selectedRoutePoints = selectedArchive?.routePoints || []
  const selectedMap = getSceneMap(selectedArchive?.sceneId || 'lab-building')
  const selectedResults = selectedArchive?.recognitionResults || []
  const selectedImages = selectedArchive?.images || []
  const abnormalResults = selectedResults.filter((result) => ['异常', '告警'].includes(result.status))
  const archiveStats = [
    { label: '查询结果', value: filteredRecords.length, unit: '项' },
    { label: '完成巡检', value: filteredRecords.filter((record) => record.status === '已完成').length, unit: '项' },
    { label: '异常档案', value: filteredRecords.filter((record) => record.abnormalCount > 0 || record.status === '异常').length, unit: '项' },
    { label: '待复核', value: filteredRecords.filter((record) => record.reviewState === '待复核').length, unit: '项' },
  ]
  const detailTabs = [
    { id: 'summary', label: '任务概览' },
    { id: 'route', label: '历史轨迹' },
    { id: 'results', label: `点位结果 ${selectedResults.length}` },
    { id: 'evidence', label: `图片证据 ${selectedImages.length}` },
    { id: 'review', label: `异常复核 ${abnormalResults.length}` },
  ]

  useEffect(() => {
    setPage(1)
  }, [conclusion, dateRange, query, robot, sortBy])

  useEffect(() => {
    setDetailTab('summary')
  }, [selectedArchive?.id])

  const resetFilters = () => {
    setQuery('')
    setDateRange('all')
    setConclusion('all')
    setRobot('all')
    setSortBy('newest')
  }

  return (
    <section className="console-panel archive-panel archive-panel-refined">
      <div className="archive-toolbar">
        <div className="archive-title-block">
          <div>
            <h2>历史巡检档案</h2>
            <span className={`archive-source-badge ${archiveRecords[0]?.source === 'business' ? 'real' : 'fallback'}`}>
              {archiveRecords[0]?.source === 'business' ? '数据库档案' : '演示兜底数据'}
            </span>
          </div>
          <p>按任务执行实例归档真实路线、识别结果、图片证据和复核结论。</p>
        </div>
        <div className="archive-filter-grid">
          <label className="archive-search">
            <span>搜索</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="档案编号 / 任务 / 区域 / 路线"
            />
          </label>
          <label><span>日期</span><select value={dateRange} onChange={(event) => setDateRange(event.target.value)}>
            <option value="all">全部时间</option>
            <option value="today">今日</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
          </select></label>
          <label><span>结论</span><select value={conclusion} onChange={(event) => setConclusion(event.target.value)}>
            <option value="all">全部结论</option>
            <option value="completed">已完成</option>
            <option value="abnormal">存在异常</option>
            <option value="interrupted">异常/中断</option>
            <option value="pending">待复核</option>
          </select></label>
          <label><span>机器人</span><select value={robot} onChange={(event) => setRobot(event.target.value)}>
            <option value="all">全部机器人</option>
            {robots.map((item) => <option value={item} key={item}>{item}</option>)}
          </select></label>
          <label><span>排序</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="newest">时间倒序</option>
            <option value="oldest">时间正序</option>
            <option value="abnormal">异常优先</option>
          </select></label>
          <div className="archive-toolbar-actions">
            <button type="button" onClick={resetFilters}>重置</button>
            <button type="button" onClick={onReload}>刷新</button>
            <button type="button" className="primary" disabled={filteredRecords.length === 0} onClick={() => exportArchiveCsv(filteredRecords)}>导出 CSV</button>
          </div>
        </div>
      </div>

      {(loading || error) && (
        <div className={`archive-data-state${error ? ' error' : ''}`}>
          {error ? `后端档案读取失败，当前显示兜底数据：${error}` : '正在同步后端巡检档案…'}
        </div>
      )}

      <div className="archive-master-detail">
        <div className="archive-master-column">
          <div className="archive-kpi-grid archive-kpi-compact">
            {archiveStats.map((item) => (
              <article key={item.label}>
                <span>{item.label}</span>
                <strong>{String(item.value).padStart(2, '0')}<em>{item.unit}</em></strong>
              </article>
            ))}
          </div>

          <div className="archive-list-card">
            <div className="archive-table archive-table-refined">
              <div className="archive-table-row archive-table-head">
                <span>档案 / 任务</span>
                <span>巡检时间</span>
                <span>路线与机器人</span>
                <span>路线进度</span>
                <span>异常 / 复核</span>
                <span>结论</span>
                <span>操作</span>
              </div>
              <div className="archive-table-body">
                {pageRecords.length > 0 ? pageRecords.map((record) => (
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
                    <strong>{record.name}<small>{record.archiveNo}</small></strong>
                    <span>{record.start.slice(0, 10)}<small>{record.start.slice(11, 16)} → {record.endTime === '--' ? '--:--' : record.endTime.slice(11, 16)} · {record.duration}</small></span>
                    <span>{record.routeName}<small>{record.robot} · {record.area}</small></span>
                    <span><b className="archive-progress-value">{record.detail.currentPoint}/{record.detail.pointTotal}</b><small>{record.progress}%</small></span>
                    <span className={record.abnormalCount > 0 ? 'archive-danger' : 'archive-ok'}>{record.abnormalCount} 项<small>{record.reviewState}</small></span>
                    <TaskStatus status={record.status} />
                    <div className="archive-row-actions">
                      <button
                        type="button"
                        disabled={!record.routePoints?.length}
                        title={record.routePoints?.length ? '按历史路线进行3D回放' : '该档案未保存路线快照'}
                        onClick={(event) => { event.stopPropagation(); onReplay(record) }}
                      >
                        3D回放
                      </button>
                      <button
                        type="button"
                        disabled={record.reviewState === '待复核'}
                        title={record.reviewState === '待复核' ? '完成异常复核后才能生成报告' : '查看巡检报告'}
                        onClick={(event) => { event.stopPropagation(); onReport(record) }}
                      >
                        报告
                      </button>
                    </div>
                  </article>
                )) : (
                  <div className="archive-empty-state">
                    <strong>没有符合条件的巡检档案</strong>
                    <span>请调整日期、结论、机器人或搜索条件。</span>
                    <button type="button" onClick={resetFilters}>清除筛选</button>
                  </div>
                )}
              </div>
            </div>
            <footer className="archive-pagination">
              <span>共 {filteredRecords.length} 条，第 {safePage}/{totalPages} 页</span>
              <div>
                <button type="button" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
                <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button>
              </div>
            </footer>
          </div>
        </div>

        <aside className="archive-detail-card">
          {selectedArchive ? (
            <>
              <header className="archive-detail-head">
                <div>
                  <span>{selectedArchive.archiveNo}</span>
                  <strong>{selectedArchive.name}</strong>
                  <small>{selectedArchive.area}</small>
                </div>
                <TaskStatus status={selectedArchive.reviewState} />
              </header>
              <nav className="archive-detail-tabs" aria-label="档案详情分类">
                {detailTabs.map((tab) => (
                  <button
                    type="button"
                    className={detailTab === tab.id ? 'active' : ''}
                    onClick={() => setDetailTab(tab.id)}
                    key={tab.id}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
              <div className="archive-detail-body">
                {detailTab === 'summary' && (
                  <div className="archive-summary-view">
                    <dl className="archive-summary-grid">
                      <div><dt>任务结论</dt><dd><TaskStatus status={selectedArchive.status} /></dd></div>
                      <div><dt>执行机器人</dt><dd>{selectedArchive.robot}</dd></div>
                      <div><dt>实际开始</dt><dd>{selectedArchive.start}</dd></div>
                      <div><dt>实际结束</dt><dd>{selectedArchive.endTime}</dd></div>
                      <div><dt>实际用时</dt><dd>{selectedArchive.duration}</dd></div>
                      <div><dt>路线进度</dt><dd>{selectedArchive.detail.currentPoint}/{selectedArchive.detail.pointTotal} · {selectedArchive.progress}%</dd></div>
                      <div><dt>识别结果</dt><dd>{selectedArchive.resultCount} 项</dd></div>
                      <div><dt>图片证据</dt><dd>{selectedImages.length} 张</dd></div>
                      <div><dt>复核状态</dt><dd>{selectedArchive.reviewState}</dd></div>
                      <div><dt>任务创建人</dt><dd>{selectedArchive.createdBy || '系统'}</dd></div>
                    </dl>
                    {selectedArchive.failureReason && (
                      <div className="archive-failure-reason">
                        <strong>中断/失败原因</strong>
                        <span>{selectedArchive.failureReason}</span>
                      </div>
                    )}
                    <div className="archive-history-list">
                      <h3>真实过程事件</h3>
                      {selectedArchive.timeline.map((item, index) => (
                        <article className={`timeline-${item.state}`} key={`${selectedArchive.id}-${index}-${item.time}`}>
                          <time>{item.time}</time>
                          <span>{item.type}</span>
                          <strong>{item.label}</strong>
                        </article>
                      ))}
                    </div>
                  </div>
                )}

                {detailTab === 'route' && (
                  <div className="archive-route-view">
                    {selectedRoutePoints.length > 0 ? (
                      <>
                        <div className="archive-route-map">
                          <PlanRoutePreview
                            compact
                            pointIds={selectedRoutePoints.map((point) => point.id)}
                            routePoints={selectedRoutePoints}
                            mapData={selectedMap}
                            showRoute
                          />
                        </div>
                        <div className="archive-point-sequence">
                          {selectedRoutePoints.map((point, index) => {
                            const reached = index < selectedArchive.detail.currentPoint
                            return (
                              <article className={reached ? 'reached' : 'pending'} key={point.id || index}>
                                <span>{String(index + 1).padStart(2, '0')}</span>
                                <div><strong>{point.targetName || point.name || `路线点 ${index + 1}`}</strong><small>x {point.x} / y {point.y}</small></div>
                                <b>{reached ? '已到达' : '未到达'}</b>
                              </article>
                            )
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="archive-empty-state compact"><strong>未保存历史路线快照</strong><span>该档案创建时没有持久化路线点。</span></div>
                    )}
                  </div>
                )}

                {detailTab === 'results' && (
                  <div className="archive-result-list">
                    {selectedResults.length > 0 ? selectedResults.map((result, index) => (
                      <article key={result.id || `${result.targetName}-${index}`}>
                        <div>
                          <span>{result.pointId || `P${String(index + 1).padStart(2, '0')}`}</span>
                          <strong>{result.targetName || result.title}</strong>
                          <small>{result.recognitionType} · {result.capturedAt || result.time}</small>
                        </div>
                        <dl>
                          <div><dt>识别值</dt><dd>{result.value}</dd></div>
                          <div><dt>标准范围</dt><dd>{result.standardRange || '未配置'}</dd></div>
                          <div><dt>置信度</dt><dd>{result.confidence || '--'}</dd></div>
                        </dl>
                        <TaskStatus status={result.status || '正常'} />
                      </article>
                    )) : (
                      <div className="archive-empty-state compact"><strong>暂无识别结果</strong><span>该执行实例未关联识别结果。</span></div>
                    )}
                  </div>
                )}

                {detailTab === 'evidence' && (
                  <div className="archive-evidence-grid">
                    {selectedImages.length > 0 ? selectedImages.map((image, index) => (
                      <figure key={image.id || `${image.fileUrl}-${index}`}>
                        <img src={image.fileUrl} alt={`${selectedArchive.name} 图片证据 ${index + 1}`} loading="lazy" />
                        <figcaption>
                          <strong>{image.pointId || `证据 ${index + 1}`}</strong>
                          <span>{image.imageType || 'visible'} · {image.capturedAt || '--'}</span>
                        </figcaption>
                      </figure>
                    )) : (
                      <div className="archive-empty-state compact"><strong>暂无图片证据</strong><span>后端尚未为该档案保存原始图片。</span></div>
                    )}
                  </div>
                )}

                {detailTab === 'review' && (
                  <div className="archive-review-list">
                    {abnormalResults.length > 0 ? abnormalResults.map((result, index) => (
                      <article key={result.id || `${result.targetName}-${index}`}>
                        <header><strong>{result.targetName}</strong><TaskStatus status={result.reviewStatus || '待复核'} /></header>
                        <dl>
                          <div><dt>异常结果</dt><dd>{result.value}</dd></div>
                          <div><dt>识别时间</dt><dd>{result.capturedAt || '--'}</dd></div>
                          <div><dt>复核人员</dt><dd>{result.reviewedBy || '未复核'}</dd></div>
                          <div><dt>复核时间</dt><dd>{result.reviewedAt || '--'}</dd></div>
                        </dl>
                        <p>{result.reviewRemark || '暂无复核备注'}</p>
                      </article>
                    )) : (
                      <div className="archive-empty-state compact"><strong>无需异常复核</strong><span>该档案没有异常或告警识别结果。</span></div>
                    )}
                  </div>
                )}
              </div>
              <footer className="archive-detail-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!selectedArchive.routePoints?.length}
                  title={selectedArchive.routePoints?.length ? '按历史路线进行3D回放' : '该档案未保存路线快照'}
                  onClick={() => onReplay(selectedArchive)}
                >
                  3D过程回放
                </button>
                <button type="button" disabled={selectedResults.length === 0} onClick={() => onShowAi(selectedArchive)}>查看全部AI记录</button>
                <button type="button" disabled={selectedArchive.reviewState === '待复核'} onClick={() => onReport(selectedArchive)}>查看巡检报告</button>
              </footer>
            </>
          ) : (
            <div className="archive-empty-state"><strong>请选择巡检档案</strong><span>选中左侧记录后查看完整执行详情。</span></div>
          )}
        </aside>
      </div>
    </section>
  )
}

function AiReviewView({ aiRecords, selectedTaskId, onSelectTask, onReview, onReplay }) {
  const selectedRecords = aiRecords.filter((record) => record.taskId === selectedTaskId)
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
                className={`ai-record-row${selectedTaskId === record.taskId ? ' selected' : ''}`}
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

function ReportCenterView({ reportRecords, selectedReportId, onSelect, onPreview, onReplay }) {
  const selectedReport = reportRecords.find((record) => record.id === selectedReportId) || reportRecords[0]
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
  routePoints = null,
  mapData = hanlinRoomMap,
  vehiclePose = null,
  compact = false,
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
  const selectedRoutePoints = Array.isArray(routePoints)
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
      preserveAspectRatio="xMidYMid meet"
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
      {vehiclePose?.modelPoint && (
        <g
          className="map-live-vehicle"
          transform={`translate(${vehiclePose.modelPoint.x} ${vehiclePose.modelPoint.y}) rotate(${-vehiclePose.yaw * 180 / Math.PI})`}
        >
          <circle r={headingLength * 0.32} />
          <path
            d={[
              `M ${headingLength * 0.58} 0`,
              `L ${-headingLength * 0.28} ${headingLength * 0.3}`,
              `L ${-headingLength * 0.12} 0`,
              `L ${-headingLength * 0.28} ${-headingLength * 0.3}`,
              'Z',
            ].join(' ')}
          />
        </g>
      )}
    </svg>
  )

  if (compact) {
    return <div className="route-preview task-mini-route-preview"><div className="route-map-canvas">{mapSvg}</div></div>
  }

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

function InteractiveRouteMap({ taskId, pointIds, routePoints, mapData, vehiclePose = null }) {
  const viewportRef = useRef(null)
  const dragRef = useRef(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })

  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 })
  }, [taskId])

  const zoomAt = (nextScale, anchorX, anchorY) => {
    setView((current) => {
      const scale = Math.max(0.75, Math.min(4, nextScale))
      if (scale === current.scale) return current
      const rect = viewportRef.current?.getBoundingClientRect()
      const centerX = anchorX ?? (rect?.width || 0) / 2
      const centerY = anchorY ?? (rect?.height || 0) / 2
      const ratio = scale / current.scale
      return {
        scale,
        x: centerX - (centerX - current.x) * ratio,
        y: centerY - (centerY - current.y) * ratio,
      }
    })
  }

  const handleWheel = (event) => {
    event.preventDefault()
    const rect = viewportRef.current.getBoundingClientRect()
    const direction = event.deltaY < 0 ? 1.16 : 1 / 1.16
    zoomAt(view.scale * direction, event.clientX - rect.left, event.clientY - rect.top)
  }

  const handlePointerDown = (event) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: view.x, originY: view.y }
  }

  const handlePointerMove = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setView((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.x,
      y: drag.originY + event.clientY - drag.y,
    }))
  }

  const finishDrag = (event) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  const reset = () => setView({ scale: 1, x: 0, y: 0 })

  return (
    <div
      ref={viewportRef}
      className="task-route-panzoom"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDoubleClick={reset}
    >
      <div
        className="task-route-panzoom-content"
        style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
      >
        <PlanRoutePreview
          compact
          pointIds={pointIds}
          routePoints={routePoints}
          mapData={mapData}
          vehiclePose={vehiclePose}
          showRoute
        />
      </div>
      <div className="task-route-zoom-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" aria-label="缩小路线图" onClick={() => zoomAt(view.scale / 1.2)}>−</button>
        <b>{Math.round(view.scale * 100)}%</b>
        <button type="button" aria-label="放大路线图" onClick={() => zoomAt(view.scale * 1.2)}>＋</button>
        <button type="button" className="reset" onClick={reset}>复位</button>
      </div>
      <span className="task-route-gesture-tip">按住拖动 · 滚轮缩放 · 双击复位</span>
    </div>
  )
}

function TaskActionButtons({ task, onAction, onMonitor, onEdit, onDelete, variant = 'row' }) {
  const modal = variant === 'modal'
  return (
    <div className={modal ? 'task-detail-modal-actions' : 'row-actions'}>
      {task.status === '待执行' && (
        <>
          <button type="button" className="action-edit" onClick={(event) => onEdit(event, task)}>{modal ? '编辑任务' : '编辑'}</button>
          <button type="button" className="action-start" onClick={(event) => onAction(event, task, 'start')}>{modal ? '开始任务' : '开始'}</button>
        </>
      )}
      {task.status === '执行中' && (
        <>
          <button type="button" className="action-start" onClick={(event) => onMonitor(event, task)}>{modal ? '实时监控' : '监控'}</button>
          <button type="button" className="action-remote" onClick={(event) => onAction(event, task, 'remote')}>遥控</button>
          <button type="button" onClick={(event) => onAction(event, task, 'pause')}>{modal ? '暂停任务' : '暂停'}</button>
        </>
      )}
      {task.status === '异常' && (
        <>
          <button type="button" className="action-alarm" onClick={(event) => onAction(event, task, 'inspect')}>{modal ? '异常详情' : '异常'}</button>
          <button type="button" onClick={(event) => onAction(event, task, 'review')}>{modal ? '提交复核' : '复核'}</button>
        </>
      )}
      {task.status === '已完成' && (
        <>
          <button type="button" onClick={(event) => onAction(event, task, 'record')}>{modal ? '巡检记录' : '记录'}</button>
          <button type="button" onClick={(event) => onAction(event, task, 'report')}>{modal ? '巡检报告' : '报告'}</button>
        </>
      )}
      {task.status === '待审核' && (
        <button type="button" className="action-start" onClick={(event) => onAction(event, task, 'resume')}>{modal ? '继续任务' : '继续'}</button>
      )}
      <button
        type="button"
        className="action-delete"
        disabled={task.status === '执行中'}
        title={task.status === '执行中' ? '请先暂停任务，再执行删除' : '删除任务'}
        onClick={(event) => onDelete(event, task)}
      >{modal ? '删除任务' : '删除'}</button>
    </div>
  )
}

function ClusterControl() {
  const navigate = useNavigate()
  const {
    business,
    loading: archiveLoading,
    error: archiveError,
    reload: reloadArchive,
  } = useBusinessOverview({ pollMs: 10000 })
  const [activeTab, setActiveTab] = useState('plan')
  const [taskList, setTaskList] = useState(initialTasks)
  const [selectedTaskId, setSelectedTaskId] = useState(initialTasks[0].id)
  const [detailTaskId, setDetailTaskId] = useState(null)
  const [actionNotice, setActionNotice] = useState('点击任务行查看执行详情，或使用右侧操作推进任务状态。')
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [planForm, setPlanForm] = useState(() => ({
    ...defaultPlanForm,
    ...getCurrentPlanSchedule(),
  }))
  const [planStep, setPlanStep] = useState(1)
  const [showSlamMap, setShowSlamMap] = useState(false)
  const [storedResults, setStoredResults] = useState(() => getInspectionResults())
  const [taskMonitorTelemetry, setTaskMonitorTelemetry] = useState(null)
  const terminalExecutionRef = useRef(new Set())
  const [taskCameraAvailable, setTaskCameraAvailable] = useState(true)
  const [taskCameraRetryNonce, setTaskCameraRetryNonce] = useState(0)
  const activePlanMap = getSceneMap(planForm.sceneId)
  const activePlanRoutePoints = getPlanRoutePoints(planForm)

  useEffect(() => {
    if (
      planForm.sceneId !== 'lab-building'
      || (planForm.routePoints?.length || 0) > 0
      || (planForm.selectedPointIds?.length || 0) === 0
    ) {
      return
    }

    // 兼容热更新前已经打开的表单：旧状态只有 selectedPointIds，
    // 左侧会显示预设点，但右侧 routePoints 仍为空。
    const presetRoutePoints = getPresetPlanRoutePoints('lab-building')
    const presetPointIds = new Set(presetRoutePoints.map((point) => point.id))
    if (!planForm.selectedPointIds.every((pointId) => presetPointIds.has(pointId))) {
      return
    }

    setPlanForm((currentForm) => ({
      ...currentForm,
      routePoints: presetRoutePoints.filter((point) => currentForm.selectedPointIds.includes(point.id)),
    }))
  }, [planForm.routePoints, planForm.sceneId, planForm.selectedPointIds])

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
  const detailTask = useMemo(
    () => taskList.find((task) => task.id === detailTaskId) || null,
    [detailTaskId, taskList],
  )
  const detailTaskMap = getSceneMap(detailTask?.sceneId || 'lab-building')
  const detailRoutePoints = useMemo(() => {
    if (!detailTask) return []
    if (detailTask.routePoints?.length) return detailTask.routePoints
    if (detailTask.pointIds?.length) {
      return detailTask.pointIds.map((pointId) => allInspectionPointById[pointId]).filter(Boolean)
    }
    return detailTaskMap.inspectionPoints.slice(0, detailTask.detail?.pointTotal || detailTaskMap.inspectionPoints.length)
  }, [detailTask, detailTaskMap])
  const detailStoredResults = useMemo(
    () => detailTask ? storedResults.filter((result) => result.taskId === detailTask.id) : [],
    [detailTask, storedResults],
  )
  const detailAiItems = detailStoredResults.length > 0
    ? detailStoredResults.map(mapStoredResultToPreview)
    : (detailTask?.aiPreview || [])
  const selectedTaskResults = useMemo(() => (
    storedResults.filter((result) => result.taskId === selectedTask.id).slice(0, 3)
  ), [selectedTask.id, storedResults])
  const aiPreviewItems = selectedTaskResults.length > 0
    ? selectedTaskResults.map(mapStoredResultToPreview)
    : selectedTask.aiPreview
  const demoArchiveRecords = useMemo(() => (
    taskList
      .filter((task) => ['已完成', '异常', '待审核'].includes(task.status))
      .map((task) => buildArchiveRecord(task, storedResults))
  ), [taskList, storedResults])
  const businessArchiveRecords = useMemo(
    () => buildBusinessArchiveRecords(business, taskList),
    [business, taskList],
  )
  const archiveRecords = businessArchiveRecords.length > 0 ? businessArchiveRecords : demoArchiveRecords
  const archiveAiRecords = useMemo(() => buildArchiveAiRecords(archiveRecords), [archiveRecords])
  const demoAiRecords = useMemo(() => buildAiRecords(taskList, storedResults), [taskList, storedResults])
  const aiRecords = archiveAiRecords.length > 0 ? archiveAiRecords : demoAiRecords
  const reportRecords = useMemo(() => buildReportRecords(archiveRecords), [archiveRecords])
  const selectedArchiveRecord = useMemo(() => (
    archiveRecords.find((record) => record.id === selectedTaskId)
  ), [archiveRecords, selectedTaskId])
  const contextTask = activeTab === 'records' && selectedArchiveRecord ? selectedArchiveRecord : selectedTask
  const isContextTaskRunning = contextTask.status === '执行中'
  const isContextTaskPending = contextTask.status === '待执行'
  const contextAiItems = activeTab === 'records' && selectedArchiveRecord
    ? (selectedArchiveRecord.recognitionResults?.length ? selectedArchiveRecord.recognitionResults : selectedArchiveRecord.aiPreview)
    : aiPreviewItems
  const contextMonitor = useMemo(
    () => loadPatrolMonitorContext({ taskId: contextTask.id }),
    [contextTask.id],
  )
  const contextSceneMap = getSceneMap(contextTask.sceneId || contextMonitor?.sceneId || 'lab-building')
  const contextRoutePoints = useMemo(() => {
    if (contextTask.routePoints?.length) return contextTask.routePoints
    if (contextMonitor?.routePoints?.length) return contextMonitor.routePoints
    if (contextTask.pointIds?.length) {
      return contextTask.pointIds.map((pointId) => allInspectionPointById[pointId]).filter(Boolean)
    }
    return contextSceneMap.inspectionPoints.slice(0, contextTask.detail?.pointTotal || contextSceneMap.inspectionPoints.length)
  }, [contextMonitor, contextSceneMap, contextTask.detail?.pointTotal, contextTask.pointIds, contextTask.routePoints])
  const contextPanel = useMemo(() => {
    if (activeTab === 'records') {
      return {
        detailTitle: '档案详情',
        progressLabel: '归档进度',
        timelineTitle: '过程追溯时间项',
        aiTitle: '归档识别结果',
        primaryAction: '3D过程回放',
        moreAction: '查看AI记录',
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
      }
    }

    return {
      detailTitle: '当前任务详情',
      progressLabel: '任务进度',
      timelineTitle: '巡检执行时间项',
      aiTitle: 'AI识别结果预览',
      primaryAction: '实时监控',
      moreAction: '查看更多',
    }
  }, [activeTab])

  useEffect(() => subscribeInspectionResults(setStoredResults), [])

  useEffect(() => {
    if (!detailTaskId) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setDetailTaskId(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [detailTaskId])

  useEffect(() => {
    let cancelled = false
    let requestInFlight = false
    const vehicleId = contextTask.robot || 'nano1'
    const executionId = contextMonitor?.executionId

    setTaskMonitorTelemetry(null)
    if (!isContextTaskRunning) return undefined

    const loadTaskMonitor = async () => {
      if (requestInFlight) return
      requestInFlight = true
      try {
        const response = await fetch(`/api/vehicle/status?vehicle_id=${encodeURIComponent(vehicleId)}`, {
          credentials: 'include',
        })
        const status = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(status.detail || `车辆状态请求失败（${response.status}）`)

        let navigation = status.navigation || null
        const activeExecutionId = executionId || navigation?.execution_id
        if (activeExecutionId) {
          const routeResponse = await fetch(
            `/api/vehicle/navigation-route/status?vehicle_id=${encodeURIComponent(vehicleId)}&execution_id=${encodeURIComponent(activeExecutionId)}`,
            { credentials: 'include' },
          )
          const routeStatus = await routeResponse.json().catch(() => ({}))
          if (routeResponse.ok) navigation = routeStatus.navigation || routeStatus
        }
        if (cancelled) return

        const pose = status.localization?.valid === false ? null : readVehiclePose(status, contextSceneMap)
        setTaskMonitorTelemetry({
          connected: Boolean(status.online),
          status,
          navigation,
          pose,
          updatedAt: Date.now(),
          error: null,
        })

        if (navigation) {
          const routeTotal = Number(navigation.route_total || 0)
          const reachedCount = Number(navigation.reached_count || 0)
          const progress = routeTotal > 0 ? Math.round(Math.min(1, reachedCount / routeTotal) * 100) : 0
          const terminalStatus = navigation.state === 'completed'
            ? '已完成'
            : navigation.state === 'failed'
              ? '异常'
              : navigation.state === 'cancelled'
                ? '待审核'
                : null

          setTaskList((currentTasks) => currentTasks.map((task) => {
            if (task.id !== contextTask.id) return task
            const nextStatus = terminalStatus || task.status
            const nextProgress = terminalStatus === '已完成' ? 100 : Math.max(task.progress || 0, progress)
            const nextCurrentPoint = Math.max(task.detail?.currentPoint || 0, reachedCount)
            if (
              nextStatus === task.status
              && nextProgress === task.progress
              && nextCurrentPoint === task.detail?.currentPoint
            ) {
              return task
            }
            return {
              ...task,
              status: nextStatus,
              progress: nextProgress,
              detail: {
                ...task.detail,
                pointTotal: routeTotal || task.detail?.pointTotal || 0,
                currentPoint: nextCurrentPoint,
              },
            }
          }))
          const terminalExecutionId = navigation.execution_id || `${contextTask.id}:${navigation.state}`
          if (terminalStatus && !terminalExecutionRef.current.has(terminalExecutionId)) {
            terminalExecutionRef.current.add(terminalExecutionId)
            reloadArchive(true)
          }
        }
      } catch (error) {
        if (!cancelled) {
          setTaskMonitorTelemetry((current) => ({
            ...(current || {}),
            connected: false,
            error: error.message,
          }))
        }
      } finally {
        requestInFlight = false
      }
    }

    loadTaskMonitor()
    const timer = window.setInterval(loadTaskMonitor, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [contextMonitor?.executionId, contextSceneMap, contextTask.id, contextTask.robot, isContextTaskRunning, reloadArchive])

  useEffect(() => {
    setTaskCameraAvailable(true)
    setTaskCameraRetryNonce((value) => value + 1)
  }, [contextTask.robot, isContextTaskRunning])

  useEffect(() => {
    if (!isContextTaskRunning || taskCameraAvailable) return undefined
    const timer = window.setTimeout(() => {
      setTaskCameraRetryNonce((value) => value + 1)
      setTaskCameraAvailable(true)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [isContextTaskRunning, taskCameraAvailable])

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

  const openTaskDetail = (task) => {
    setSelectedTaskId(task.id)
    setDetailTaskId(task.id)
  }

  const handleDeleteTask = async (event, task) => {
    event.stopPropagation()

    if (task.status === '执行中') {
      setActionNotice(`${task.name} 正在执行，请先暂停任务再删除。`)
      return
    }
    if (!window.confirm(`确认删除任务“${task.name}”吗？删除后无法恢复。`)) return

    try {
      if (task.source !== 'demo') {
        await deleteSavedTask(task.id)
      }

      setTaskList((currentTasks) => {
        const nextTasks = currentTasks.filter((item) => item.id !== task.id)
        setSelectedTaskId((currentId) => (currentId === task.id ? nextTasks[0]?.id : currentId))
        return nextTasks
      })
      setDetailTaskId((currentId) => (currentId === task.id ? null : currentId))
      setActionNotice(`${task.name} 已删除。`)
    } catch (error) {
      setSelectedTaskId(task.id)
      setActionNotice(`${task.name} 删除失败：${error.message}`)
    }
  }

  const closePlanModal = () => {
    setIsPlanModalOpen(false)
    setEditingTaskId(null)
    setPlanStep(1)
    setShowSlamMap(false)
  }

  const openPlanModal = (areaTemplate) => {
    const currentSchedule = getCurrentPlanSchedule()
    setEditingTaskId(null)

    if (areaTemplate) {
      setPlanForm({
        ...getAreaForm(areaTemplate),
        ...currentSchedule,
      })
    } else {
      setPlanForm({
        ...defaultPlanForm,
        ...currentSchedule,
      })
    }

    setPlanStep(1)
    setShowSlamMap(false)
    setIsPlanModalOpen(true)
  }

  const openEditTask = (event, task) => {
    event?.stopPropagation()
    if (task.status !== '待执行' || Number(task.progress || 0) > 0) {
      setActionNotice(`${task.name} 已经启动，不能再修改任务参数和路线。`)
      return
    }

    setSelectedTaskId(task.id)
    setDetailTaskId(null)
    setEditingTaskId(task.id)
    setPlanForm(getTaskPlanForm(task))
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
    const presetRoutePoints = isLabScene ? getPresetPlanRoutePoints(sceneId) : []

    setPlanForm((currentForm) => ({
      ...currentForm,
      sceneId,
      roomId: mapData.id,
      areaId: wholeRoomScope.id,
      area: isLabScene ? `${mapData.name} / 环形走廊` : `${mapData.name} / 整房巡检`,
      name: isLabScene ? `${mapData.name}环廊巡检任务` : `${mapData.name}整房巡检任务`,
      selectedPointIds: isLabScene
        ? presetRoutePoints.map((point) => point.id)
        : getNavigablePointIds(sceneId),
      routePoints: presetRoutePoints,
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
        selectedPointIds: [...(currentForm.selectedPointIds || []), point.id],
        routePoints: [...(currentForm.routePoints || []), point],
      }
    })
  }

  const removeFreeRoutePoint = (pointId) => {
    setPlanForm((currentForm) => ({
      ...currentForm,
      selectedPointIds: (currentForm.selectedPointIds || []).filter((item) => item !== pointId),
      routePoints: (currentForm.routePoints || []).filter((point) => point.id !== pointId),
    }))
  }

  const clearPlanRoute = () => {
    setPlanForm((currentForm) => ({
      ...currentForm,
      selectedPointIds: [],
      routePoints: [],
      pointDirections: {},
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
      return {
        ...currentForm,
        selectedPointIds: routePoints.map((item) => item.id),
        routePoints,
      }
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
    const selectedCount = activePlanRoutePoints.length
    if (selectedCount === 0) {
      setActionNotice(`请至少选择 1 个巡检点后再${editingTaskId ? '保存任务' : '创建任务'}。`)
      setPlanStep(2)
      return
    }

    const originalTask = editingTaskId
      ? taskList.find((task) => task.id === editingTaskId)
      : null
    if (editingTaskId && (!originalTask || originalTask.status !== '待执行' || Number(originalTask.progress || 0) > 0)) {
      setActionNotice('任务状态已经变化，当前任务不能继续编辑。')
      closePlanModal()
      return
    }

    const generatedTask = createTaskFromForm(planForm)
    const newTask = originalTask
      ? {
          ...originalTask,
          ...generatedTask,
          id: originalTask.id,
          source: originalTask.source,
        }
      : generatedTask
    let savedTask

    try {
      if (originalTask) {
        savedTask = originalTask.source === 'demo'
          ? newTask
          : { ...newTask, ...await updateSavedTask(newTask) }
      } else {
        savedTask = await saveTask(newTask)
      }
    } catch (error) {
      console.error(originalTask ? 'update task failed' : 'save task failed', error)
      setActionNotice(`任务${originalTask ? '更新' : '保存'}失败：${error.message}`)
      return
    }

    setTaskList((currentTasks) => (
      originalTask
        ? currentTasks.map((task) => (task.id === savedTask.id ? savedTask : task))
        : [savedTask, ...currentTasks.filter((task) => task.id !== savedTask.id)]
    ))
    setSelectedTaskId(savedTask.id)
    setActiveTab('plan')
    closePlanModal()
    setActionNotice(
      originalTask
        ? `${savedTask.name} 已保存修改，任务 ID 保持不变。`
        : `${newTask.name} 已创建，状态为待执行，可直接点击“开始”。`,
    )
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

  const handleDetailTaskAction = (event, task, action) => {
    handleTaskAction(event, task, action)
    if (['remote', 'inspect', 'review', 'record', 'report'].includes(action)) {
      setDetailTaskId(null)
    }
  }

  const openPatrolReplay = (task) => {
    setSelectedTaskId(task.id)
    const replayTaskId = task.taskId || task.id
    navigate(buildPatrolMonitorUrl({ taskId: replayTaskId, vehicleId: task.robot, replayMode: true }), {
      state: {
        taskId: replayTaskId,
        archiveId: task.id,
        recordId: task.recordId,
        archiveNo: task.archiveNo,
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
    setSelectedTaskId(task.taskId || task.id)
    setActiveTab('ai')
    setActionNotice(`${task.name} 的历史 AI 识别记录已聚焦。`)
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

  const handleAiReview = async (record, reviewStatus) => {
    setSelectedTaskId(record.taskId)

    if (record.source === 'business') {
      try {
        const response = await fetch(`/api/recognition/results/${encodeURIComponent(record.id)}/review`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            review_status: reviewStatus,
            review_remark: reviewStatus === '确认异常' ? '人工复核确认异常' : '人工复核标记误报',
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.detail || '复核结果保存失败')
        await reloadArchive(true)
        setActionNotice(`${record.targetName} 已保存后端复核结论：${reviewStatus}。`)
      } catch (error) {
        setActionNotice(`${record.targetName} 复核失败：${error.message}`)
      }
      return
    }

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

  const rawMonitorNavigation = taskMonitorTelemetry?.navigation
  const monitorNavigation = (
    !rawMonitorNavigation?.task_id
    || rawMonitorNavigation.task_id === contextTask.id
    || rawMonitorNavigation.execution_id === contextMonitor?.executionId
  ) ? rawMonitorNavigation : null
  const monitorRouteTotal = Number(monitorNavigation?.route_total || contextTask.detail?.pointTotal || contextRoutePoints.length || 0)
  const monitorReachedCount = Number(monitorNavigation?.reached_count ?? contextTask.detail?.currentPoint ?? 0)
  const monitorRouteIndex = Math.max(0, Number(monitorNavigation?.route_index || monitorReachedCount || 1) - 1)
  const monitorCurrentPoint = contextRoutePoints[monitorRouteIndex]
  const monitorProgress = monitorNavigation && monitorRouteTotal > 0
    ? Math.round(Math.min(1, monitorReachedCount / monitorRouteTotal) * 100)
    : contextTask.progress
  const monitorStateLabel = taskMonitorTelemetry?.connected
    ? LIVE_NAVIGATION_LABELS[monitorNavigation?.state] || '车辆在线'
    : '车辆离线'
  const detailMonitorStateLabel = isContextTaskRunning ? monitorStateLabel : contextTask.status
  const monitorPositionLabel = taskMonitorTelemetry?.pose
    ? `map (${taskMonitorTelemetry.pose.x.toFixed(2)}, ${taskMonitorTelemetry.pose.y.toFixed(2)})`
    : '等待有效 map 位姿'

  return (
    <section className={`task-console-page${activeTab === 'records' ? ' records-task-page' : ''}`}>
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
      <div className={`task-workbench${activeTab === 'records' ? ' records-workbench' : ''}`}>
        <main className="task-left-zone">
          {activeTab === 'records' && (
            <PatrolArchiveView
              archiveRecords={archiveRecords}
              selectedArchiveId={selectedTaskId}
              onSelect={setSelectedTaskId}
              onReplay={openPatrolReplay}
              onShowAi={showArchiveAiRecords}
              onReport={showArchiveReport}
              loading={archiveLoading}
              error={archiveError}
              onReload={() => reloadArchive()}
            />
          )}

          {activeTab === 'ai' && (
            <AiReviewView
              aiRecords={aiRecords}
              selectedTaskId={selectedTaskId}
              onSelectTask={setSelectedTaskId}
              onReview={handleAiReview}
              onReplay={openReplayByTaskId}
            />
          )}

          {activeTab === 'report' && (
            <ReportCenterView
              reportRecords={reportRecords}
              selectedReportId={selectedTaskId}
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
                      onClick={() => openTaskDetail(task)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openTaskDetail(task)
                        }
                      }}
                    >
                      <strong><i />{task.name}</strong>
                      <span>{task.area}</span>
                      <span>{task.robot}</span>
                      <span>{task.start}</span>
                      <TaskStatus status={task.status} />
                      <ProgressBar value={task.progress} status={task.status} />
                      <TaskActionButtons
                        task={task}
                        onAction={handleTaskAction}
                        onMonitor={(event, currentTask) => { event.stopPropagation(); openLivePatrolMonitor(currentTask) }}
                        onEdit={openEditTask}
                        onDelete={handleDeleteTask}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </main>

        {activeTab !== 'records' && <aside className="task-side-zone task-side-zone-single">
          <section className={`console-panel current-task-panel${isContextTaskPending ? ' pending-task' : ''}`}>
            <div className="panel-heading compact task-detail-heading">
              <h2>{contextPanel.detailTitle}</h2>
              <span className={`task-live-badge ${isContextTaskRunning ? (taskMonitorTelemetry?.connected ? 'online' : 'offline') : 'standby'}`}>
                <i />{detailMonitorStateLabel}
              </span>
            </div>

            <div className="task-detail-overview">
              <div className="task-title-line">
                <div>
                  <small>{contextTask.area}</small>
                  <strong>{contextTask.name}</strong>
                </div>
                <TaskStatus status={activeTab === 'records' && contextTask.reviewState ? contextTask.reviewState : contextTask.status} />
              </div>
              <dl className="task-detail-metrics">
                <div><dt>执行机器人</dt><dd>{contextTask.robot}</dd></div>
                <div><dt>{activeTab === 'records' ? '归档编号' : '巡检点总数'}</dt><dd>{activeTab === 'records' ? contextTask.archiveNo : `${monitorRouteTotal} 个`}</dd></div>
                <div><dt>{activeTab === 'records' ? '完成点位' : '当前巡检点'}</dt><dd>{monitorReachedCount} / {monitorRouteTotal}</dd></div>
                <div><dt>异常数量</dt><dd>{contextTask.abnormalCount ?? contextTask.detail.abnormalCount} 项</dd></div>
                <div><dt>{activeTab === 'records' ? '结束时间' : '预计完成时间'}</dt><dd>{activeTab === 'records' ? contextTask.endTime?.slice(11, 16) : contextTask.detail.eta}</dd></div>
                <div><dt>当前位置</dt><dd title={monitorPositionLabel}>{monitorCurrentPoint?.targetName || monitorPositionLabel}</dd></div>
              </dl>
            </div>

            {isContextTaskPending ? (
              <article className="task-planned-route">
                <header>
                  <div>
                    <span>PLANNED ROUTE</span>
                    <strong>任务地图与巡检路线</strong>
                  </div>
                  <b>{contextRoutePoints.length} POINTS</b>
                </header>
                <div className="task-planned-route-map">
                  <PlanRoutePreview
                    compact
                    pointIds={contextRoutePoints.map((point) => point.id)}
                    routePoints={contextRoutePoints}
                    mapData={contextSceneMap}
                    showRoute
                  />
                  <div className="task-route-legend">
                    <span><i className="route-line" />按编号顺序执行</span>
                    <span><i className="route-start" />绿色为起点</span>
                    <span><i className="route-heading" />箭头为到点朝向</span>
                  </div>
                </div>
              </article>
            ) : (
            <div className="task-live-windows">
              <article className="task-live-window task-camera-window">
                <header>
                  <div><span>CAMERA</span><strong>车载摄像头</strong></div>
                  <b className={isContextTaskRunning && taskCameraAvailable ? 'online' : 'offline'}>
                    {isContextTaskRunning ? (taskCameraAvailable ? 'LIVE' : 'RETRY') : 'STANDBY'}
                  </b>
                </header>
                <div className="task-camera-frame">
                  {!isContextTaskRunning ? (
                    <div className="task-live-placeholder">
                      <i>CAM</i>
                      <strong>任务未在执行</strong>
                      <span>开始巡检后显示车载实时视频</span>
                    </div>
                  ) : taskCameraAvailable ? (
                    <img
                      src={`/api/vehicle/camera/stream?vehicle_id=${encodeURIComponent(contextTask.robot || 'nano1')}&camera_role=movement&retry=${taskCameraRetryNonce}`}
                      alt={`${contextTask.robot || 'nano1'} 车载实时视频`}
                      draggable="false"
                      onLoad={() => setTaskCameraAvailable(true)}
                      onError={() => setTaskCameraAvailable(false)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setTaskCameraRetryNonce((value) => value + 1)
                        setTaskCameraAvailable(true)
                      }}
                    >
                      视频暂不可用<br />点击重试
                    </button>
                  )}
                  {isContextTaskRunning && <i className="camera-scan-line" />}
                </div>
              </article>

              <article className="task-live-window task-map-window">
                <header>
                  <div><span>MAP POSE</span><strong>小车实时监控</strong></div>
                  <b className={isContextTaskRunning && taskMonitorTelemetry?.pose ? 'online' : 'offline'}>
                    {isContextTaskRunning ? (taskMonitorTelemetry?.pose ? 'LOC' : 'WAIT') : 'STANDBY'}
                  </b>
                </header>
                <div className="task-mini-map">
                  {isContextTaskRunning ? (
                    <>
                      <PlanRoutePreview
                        compact
                        pointIds={contextRoutePoints.map((point) => point.id)}
                        routePoints={contextRoutePoints}
                        mapData={contextSceneMap}
                        vehiclePose={taskMonitorTelemetry?.pose}
                        showRoute
                      />
                      <span>{monitorPositionLabel}</span>
                    </>
                  ) : (
                    <div className="task-live-placeholder">
                      <i>3D</i>
                      <strong>任务未在执行</strong>
                      <span>开始巡检后显示小车实时位置</span>
                    </div>
                  )}
                </div>
              </article>
            </div>
            )}

            <div className="side-progress">
              <span>{contextPanel.progressLabel}</span>
              <i><b style={{ width: `${monitorProgress}%` }} /></i>
              <strong>{monitorProgress}%</strong>
            </div>
            <div className="task-detail-footer">
              <span>
                {!isContextTaskRunning
                  ? `当前状态：${contextTask.status}，实时数据未连接`
                  : taskMonitorTelemetry?.error
                  ? taskMonitorTelemetry.error
                  : taskMonitorTelemetry?.updatedAt
                  ? `数据更新 ${new Date(taskMonitorTelemetry.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
                  : '正在连接车辆数据'}
              </span>
              <button
                type="button"
                className="detail-button"
                onClick={handleContextPrimaryAction}
                disabled={activeTab === 'plan' && !isContextTaskRunning}
              >
                {contextPanel.primaryAction}
              </button>
            </div>
          </section>
        </aside>}
      </div>

      {activeTab !== 'records' && <div className="task-bottom-zone">
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
      </div>}
      </>}

      {detailTask && (
        <div
          className="task-modal-backdrop task-detail-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetailTaskId(null)
          }}
        >
          <section className="task-detail-modal" role="dialog" aria-modal="true" aria-labelledby="task-detail-modal-title">
            <header className="task-detail-modal-head">
              <div>
                <span className="task-kicker">PATROL TASK DETAIL</span>
                <h2 id="task-detail-modal-title">{detailTask.name}</h2>
                <p>{detailTask.area} · {detailTask.robot} · {detailTask.start}</p>
              </div>
              <div className="task-detail-modal-status">
                <TaskStatus status={detailTask.status} />
                <button type="button" className="modal-close" aria-label="关闭任务详情" onClick={() => setDetailTaskId(null)}>×</button>
              </div>
            </header>

            <div className="task-detail-modal-body">
              <div className="task-detail-modal-main">
                <section className="task-detail-route-card">
                  <header>
                    <div><span>ROUTE OVERVIEW</span><strong>任务地图与有序巡检路线</strong></div>
                    <div className="task-detail-route-meta">
                      <b>{detailRoutePoints.length} 个点位</b>
                      {detailTask.status === '待执行' ? <em>支持拖动与缩放</em> : <em>路线执行视图</em>}
                    </div>
                  </header>
                  <div className="task-detail-route-map">
                    {detailTask.status === '待执行' ? (
                      <InteractiveRouteMap
                        taskId={detailTask.id}
                        pointIds={detailRoutePoints.map((point) => point.id)}
                        routePoints={detailRoutePoints}
                        mapData={detailTaskMap}
                      />
                    ) : (
                      <div className="task-detail-static-map">
                        <PlanRoutePreview
                          compact
                          pointIds={detailRoutePoints.map((point) => point.id)}
                          routePoints={detailRoutePoints}
                          mapData={detailTaskMap}
                          vehiclePose={detailTask.id === contextTask.id ? taskMonitorTelemetry?.pose : null}
                          showRoute
                        />
                      </div>
                    )}
                  </div>
                  <footer className="task-detail-route-legend">
                    <span><i className="route-line" />连线表示执行顺序</span>
                    <span><i className="route-start" />绿色为首个点位</span>
                    <span><i className="route-heading" />箭头表示到点朝向</span>
                  </footer>
                </section>

                <div className="task-detail-evidence-grid">
                  <section>
                    <header><span>PROCESS</span><strong>执行时间线</strong></header>
                    <div className="task-detail-timeline-list">
                      {detailTask.timeline.map((item, index) => (
                        <article className={`timeline-${item.state}`} key={`${detailTask.id}-${item.label}-${index}`}>
                          <time>{item.time}</time><i>{item.type}</i><strong>{item.label}</strong>
                        </article>
                      ))}
                    </div>
                  </section>
                  <section>
                    <header><span>RECOGNITION</span><strong>识别结果摘要</strong></header>
                    <div className="task-detail-ai-list">
                      {detailAiItems.slice(0, 4).map((item, index) => (
                        <article key={`${item.title}-${index}`}>
                          <div><strong>{item.title}</strong><TaskStatus status={item.status} /></div>
                          <span>{item.value}</span>
                          <small>{item.confidence} · {item.time}</small>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              </div>

              <aside className="task-detail-modal-side">
                <section className="task-detail-summary-card">
                  <header><span>TASK SUMMARY</span><strong>任务信息</strong></header>
                  <dl>
                    <div><dt>任务编号</dt><dd>{detailTask.id}</dd></div>
                    <div><dt>执行机器人</dt><dd>{detailTask.robot}</dd></div>
                    <div><dt>任务区域</dt><dd>{detailTask.area}</dd></div>
                    <div><dt>计划开始</dt><dd>{detailTask.start}</dd></div>
                    <div><dt>路线点位</dt><dd>{detailTask.detail.currentPoint || 0} / {detailRoutePoints.length || detailTask.detail.pointTotal}</dd></div>
                    <div><dt>预计完成</dt><dd>{detailTask.detail.eta || '--'}</dd></div>
                    <div><dt>异常数量</dt><dd className={detailTask.detail.abnormalCount ? 'danger' : ''}>{detailTask.detail.abnormalCount || 0} 项</dd></div>
                    <div><dt>任务优先级</dt><dd>{detailTask.priority || '普通'}</dd></div>
                  </dl>
                  <div className="task-detail-modal-progress">
                    <div><span>任务进度</span><strong>{detailTask.progress || 0}%</strong></div>
                    <i><b style={{ width: `${detailTask.progress || 0}%` }} /></i>
                  </div>
                </section>

                <section className="task-detail-point-card">
                  <header><span>ROUTE POINTS</span><strong>巡检点顺序</strong></header>
                  <div className="task-detail-point-list">
                    {detailRoutePoints.map((point, index) => {
                      const reached = index < Number(detailTask.detail.currentPoint || 0)
                      const current = detailTask.status === '执行中' && index === Number(detailTask.detail.currentPoint || 0)
                      const direction = ARRIVAL_DIRECTIONS.find((item) => item.value === getPlanPointDirection(point))?.label || '东（0°）'
                      return (
                        <article className={reached ? 'reached' : current ? 'current' : 'pending'} key={point.id || index}>
                          <b>{String(index + 1).padStart(2, '0')}</b>
                          <div><strong>{point.targetName || point.name || `巡检点 ${index + 1}`}</strong><small>{point.id || '--'} · {direction}</small></div>
                          <span>{reached ? '已到达' : current ? '当前点' : '待执行'}</span>
                        </article>
                      )
                    })}
                    {detailRoutePoints.length === 0 && <div className="business-empty">该任务没有保存路线点</div>}
                  </div>
                </section>
              </aside>
            </div>

            <footer className="task-detail-modal-footer">
              <span>{detailTask.status === '待执行' ? '启动前请确认车辆定位、路线点和现场安全。' : `当前状态：${detailTask.status}`}</span>
              <div>
                <TaskActionButtons
                  variant="modal"
                  task={detailTask}
                  onAction={handleDetailTaskAction}
                  onMonitor={(event, currentTask) => { event.stopPropagation(); setDetailTaskId(null); openLivePatrolMonitor(currentTask) }}
                  onEdit={openEditTask}
                  onDelete={handleDeleteTask}
                />
                <button type="button" className="task-detail-close-button" onClick={() => setDetailTaskId(null)}>关闭</button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {isPlanModalOpen && (
        <div className="task-modal-backdrop" role="presentation">
          <section className="task-plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-modal-title">
            <div className="modal-heading">
              <div>
                <span className="task-kicker">{editingTaskId ? 'EDIT PATROL TASK' : 'CREATE PATROL PLAN'}</span>
                <h2 id="plan-modal-title">{editingTaskId ? '编辑待执行任务' : '新建巡检计划'}</h2>
              </div>
              <button type="button" className="modal-close" aria-label="关闭任务表单" onClick={closePlanModal}>×</button>
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
                      <select aria-label="执行机器人" value={planForm.robot} onChange={(event) => updatePlanForm('robot', event.target.value)}>
                        <option value="nano1">nano1</option>
                        <option value="nano2">nano2</option>
                        <option value="nano3">nano3</option>
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
                      <select aria-label="任务优先级" value={planForm.priority} onChange={(event) => updatePlanForm('priority', event.target.value)}>
                        {PLAN_PRIORITY_OPTIONS.map((priority) => (
                          <option value={priority} key={priority}>{priority}</option>
                        ))}
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
                    pointIds={activePlanRoutePoints.map((point) => point.id)}
                    routePoints={activePlanRoutePoints}
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
                          <span>{activePlanRoutePoints.length} 个已选点</span>
                        </div>
                        <button type="button" onClick={reversePlanRoute}>反向执行</button>
                      </div>
                      <div className="route-order-list">
                        {activePlanRoutePoints.map((point, index) => {
                          const pointId = point.id
                          const arrivalDirection = getPlanPointDirection(point, planForm.pointDirections)

                          return (
                            <article key={pointId}>
                              <span>{String(index + 1).padStart(2, '0')}</span>
                              <div className="route-point-copy">
                                <strong>{point.targetName}</strong>
                                <small>{planForm.sceneId === 'lab-building' ? `x ${point.x} / y ${point.y}` : point.name}</small>
                              </div>
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
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  onClick={() => (planForm.sceneId === 'lab-building' ? moveFreeRoutePoint(pointId, -1) : movePlanPoint(pointId, -1))}
                                >
                                  上移
                                </button>
                                <button
                                  type="button"
                                  disabled={index === activePlanRoutePoints.length - 1}
                                  onClick={() => (planForm.sceneId === 'lab-building' ? moveFreeRoutePoint(pointId, 1) : movePlanPoint(pointId, 1))}
                                >
                                  下移
                                </button>
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
                    <div className="fixed-point-panel free-point-panel">
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
                        <button type="button" onClick={clearPlanRoute}>清空路线</button>
                      </div>
                    </div>
                    )}
                  </aside>
                  <div className="plan-step-note">
                    左侧选择或添加巡检点，右侧可调整执行顺序与每个点的到达朝向。
                  </div>
                </div>
              )}

              <div className="plan-summary">
                <strong>{planForm.name || '未命名任务'}</strong>
                <span>{planForm.area} / {planForm.robot}</span>
                <span>
                  {activePlanRoutePoints.length}
                  {planForm.sceneId === 'lab-building' ? ' 个路线点' : ' 个固定巡检点'}
                  {' / '}{getEstimatedMinutes(activePlanRoutePoints.length)} 分钟 / {planForm.priority}优先级</span>
              </div>

              <div className="modal-actions">
                <button type="button" onClick={closePlanModal}>取消</button>
                {planStep > 1 && <button type="button" onClick={() => setPlanStep(planStep - 1)}>上一步</button>}
                {planStep < 2 && <button type="button" className="primary" onClick={() => setPlanStep(planStep + 1)}>下一步</button>}
                {planStep === 2 && <button type="submit" className="primary">{editingTaskId ? '保存修改' : '创建任务'}</button>}
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}

export default ClusterControl
