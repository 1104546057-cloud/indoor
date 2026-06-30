const createCabinetRow = ({ prefix, start, count, x, y, widths, depth, face }) => {
  let cursor = x

  return Array.from({ length: count }, (_, index) => {
    const width = widths[index] ?? widths[widths.length - 1]
    const number = String(start + index).padStart(2, '0')
    const cabinet = {
      id: `${prefix}${number}`,
      name: `${prefix}${number}`,
      type: prefix === 'P' ? 'power-cabinet' : 'grid-cabinet',
      x: cursor,
      y,
      width,
      depth,
      height: 2200,
      face,
    }

    cursor += width
    return cabinet
  })
}

const p28ToP35 = createCabinetRow({
  prefix: 'P',
  start: 28,
  count: 8,
  x: 500,
  y: 640,
  widths: [1200, 800, 800, 800, 800, 800, 800, 600],
  depth: 1050,
  face: 'south',
})

const p17ToP27 = createCabinetRow({
  prefix: 'P',
  start: 17,
  count: 11,
  x: 9550,
  y: 640,
  widths: Array(11).fill(600),
  depth: 1050,
  face: 'south',
})

const p01ToP16 = createCabinetRow({
  prefix: 'P',
  start: 1,
  count: 16,
  x: 5400,
  y: 6200,
  widths: [1200, 600, 600, 600, 600, 600, 600, 1200, 600, 600, 600, 600, 600, 600, 600, 600],
  depth: 1050,
  face: 'north',
})

const g07ToG12 = createCabinetRow({
  prefix: 'G',
  start: 7,
  count: 6,
  x: 20550,
  y: 640,
  widths: [1200, 800, 800, 800, 800, 800],
  depth: 1450,
  face: 'south',
})

const g01ToG06 = createCabinetRow({
  prefix: 'G',
  start: 1,
  count: 6,
  x: 20550,
  y: 6200,
  widths: Array(6).fill(800),
  depth: 1450,
  face: 'north',
})

const transformers = [
  { id: 'T1', name: '1#', type: 'transformer', x: 16750, y: 5980, width: 2400, depth: 1600, height: 1800, face: 'west' },
  { id: 'T2', name: '2#', type: 'transformer', x: 16750, y: 650, width: 2400, depth: 1600, height: 1800, face: 'west' },
  { id: 'T3', name: '3#', type: 'transformer', x: 430, y: 6000, width: 2400, depth: 1600, height: 1800, face: 'east' },
]

const cabinets = [
  ...p28ToP35,
  ...p17ToP27,
  ...p01ToP16,
  ...g07ToG12,
  ...g01ToG06,
  ...transformers,
]

const getInspectionPoint = (cabinet) => {
  const centerX = cabinet.x + cabinet.width / 2
  const centerY = cabinet.y + cabinet.depth / 2
  const offset = cabinet.type === 'transformer' ? 720 : 620

  const pointByFace = {
    north: { x: centerX, y: cabinet.y - offset },
    south: { x: centerX, y: cabinet.y + cabinet.depth + offset },
    east: { x: cabinet.x + cabinet.width + offset, y: centerY },
    west: { x: cabinet.x - offset, y: centerY },
  }

  const point = pointByFace[cabinet.face] || { x: centerX, y: centerY }

  return {
    id: `IP-${cabinet.id}`,
    name: `${cabinet.name}巡检点`,
    cabinetId: cabinet.id,
    targetName: cabinet.name,
    x: point.x,
    y: point.y,
    yaw: cabinet.face,
    recognitionTargets: cabinet.type === 'transformer'
      ? ['温度识别', '外观状态', '运行噪声']
      : ['电压表识别', '电流表识别', '指示灯识别', '手柄状态识别'],
  }
}

const inspectionPoints = cabinets.map(getInspectionPoint)

const pointIds = (...cabinetIds) => cabinetIds.map((id) => `IP-${id}`)

const routes = [
  {
    id: 'route-p-main',
    name: 'P柜全量巡检路线',
    roomId: 'hanlin-1-power-room',
    area: '瀚林1号电房 / P柜区',
    robot: 'nano1',
    priority: '高',
    estimatedMinutes: 55,
    pointIds: pointIds(
      ...p28ToP35.map((item) => item.id),
      ...p17ToP27.map((item) => item.id),
      ...p01ToP16.map((item) => item.id),
    ),
  },
  {
    id: 'route-g-main',
    name: 'G柜全量巡检路线',
    roomId: 'hanlin-1-power-room',
    area: '瀚林1号电房 / G柜区',
    robot: 'nano2',
    priority: '中',
    estimatedMinutes: 30,
    pointIds: pointIds(
      ...g07ToG12.map((item) => item.id),
      ...g01ToG06.map((item) => item.id),
    ),
  },
  {
    id: 'route-transformer',
    name: '1#-3#设备专项巡检',
    roomId: 'hanlin-1-power-room',
    area: '瀚林1号电房 / 变压器区',
    robot: 'nano3',
    priority: '高',
    estimatedMinutes: 22,
    pointIds: pointIds('T2', 'T1', 'T3'),
  },
  {
    id: 'route-night-fast',
    name: '夜间快速异常复核路线',
    roomId: 'hanlin-1-power-room',
    area: '瀚林1号电房 / 重点点位',
    robot: 'nano1',
    priority: '紧急',
    estimatedMinutes: 18,
    pointIds: pointIds('P17', 'P21', 'P27', 'P08', 'P16', 'G01', 'G06'),
  },
]

export const hanlinRoomMap = {
  id: 'hanlin-1-power-room',
  name: '瀚林1号电房',
  source: {
    type: 'pdf',
    name: '瀚林1号电房平面图尺寸(1).pdf',
    note: '坐标根据平面图尺寸整理，单位为毫米；黄色线为 100mm 宽地面地标线，不作为墙体或障碍物。',
  },
  size: {
    width: 26400,
    height: 8800,
    unit: 'mm',
  },
  landmarkLines: [
    { id: 'mark-p-top', name: 'P柜上排地标线', x: 0, y: 0, width: 19350, height: 2550, lineWidth: 100 },
    { id: 'mark-p-bottom', name: 'P柜下排地标线', x: 5100, y: 5100, width: 14250, height: 3100, lineWidth: 100 },
    { id: 'mark-g-top', name: 'G柜上排地标线', x: 20210, y: 0, width: 5920, height: 3050, lineWidth: 100 },
    { id: 'mark-g-bottom', name: 'G柜下排地标线', x: 20250, y: 5100, width: 5400, height: 3050, lineWidth: 100 },
    { id: 'mark-transformer-west', name: '3#设备地标线', x: 130, y: 5600, width: 3200, height: 2400, lineWidth: 100 },
  ],
  entrances: [
    { id: 'entry-main', name: '主通道入口', x: 5100, y: 4300 },
    { id: 'entry-east', name: 'G柜区入口', x: 19800, y: 4300 },
  ],
  cabinets,
  inspectionPoints,
  routes,
}

export const inspectionPointById = Object.fromEntries(
  hanlinRoomMap.inspectionPoints.map((point) => [point.id, point]),
)

export const routeById = Object.fromEntries(
  hanlinRoomMap.routes.map((route) => [route.id, route]),
)
