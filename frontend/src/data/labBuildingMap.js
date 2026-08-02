// 实验楼地图统一使用毫米（mm）作为坐标和尺寸单位。
// 创建走廊：起点 (x1, y1)、终点 (x2, y2)、宽度 width。
const corridor = (id, name, x1, y1, x2, y2, width = 4050) => ({ id, name, x1, y1, x2, y2, width })

// 五条主走廊：上、下横廊，以及左、中、右纵廊。
const corridors = [
  corridor('corridor-top', '北侧横向走廊', 6000, 15000, 94000, 15000),
  corridor('corridor-bottom', '南侧横向走廊', 6000, 53500, 94000, 53500),
  corridor('corridor-west', '西侧纵向走廊', 6000, 3000, 6000, 67000),
  corridor('corridor-center', '中央纵向走廊', 50000, 17000, 50000, 52000),
  corridor('corridor-east', '东侧纵向走廊', 94000, 7500, 94000, 64000),
]

// 四个大厅区域；elevation 是相对走廊地面的高差。
// 左右下沉广场为 -120mm。
const halls = [
  { id: 'hall-north', name: '北侧大厅', x: 38000, y: 3000, width: 24000, depth: 11975, elevation: 0 },
  { id: 'hall-south', name: '南侧大厅', x: 41000, y: 54025, width: 18000, depth: 12975, elevation: 0 },
  { id: 'hall-west', name: '西侧下沉广场', x: 12000, y: 22000, width: 24000, depth: 25000, elevation: -120 },
  { id: 'hall-east', name: '东侧下沉广场', x: 66000, y: 22000, width: 21000, depth: 25000, elevation: -120 },
]

// 根据大厅边界自动生成柱列；坡道范围内会自动跳过柱子。
function createPlazaColumns(hall, prefix, corridorSide) {
  const columns = []
  // 柱子尺寸：长 1500mm、宽 1000mm；柱间净距 3500mm。
  const length = 1500
  const width = 1000
  const clearGap = 3500
  const pitch = length + clearGap
  // 四条走廊边界，用于让柱子贴着走廊一侧排列。
  const topCorridorEdge = 19025
  const bottomCorridorEdge = 49975
  const westCorridorEdge = 8025
  const eastCorridorEdge = 91975

  // 大厅上、下两侧的横向柱列。
  for (let centerX = hall.x + length / 2; centerX <= hall.x + hall.width - length / 2; centerX += pitch) {
    columns.push({ id: `${prefix}-north-${centerX}`, x: centerX, y: topCorridorEdge + width / 2, sizeX: length, sizeY: width, height: 3200 })
    columns.push({ id: `${prefix}-south-${centerX}`, x: centerX, y: bottomCorridorEdge - width / 2, sizeX: length, sizeY: width, height: 3200 })
  }

  // 大厅外侧的纵向柱列；中间坡道位置不放柱子。
  for (let centerY = hall.y + 4750; centerY <= hall.y + hall.depth - 4750; centerY += pitch) {
    const overlapsRamp = centerY + length / 2 > 32250 && centerY - length / 2 < 36750
    if (corridorSide === 'west' && !overlapsRamp) {
      columns.push({ id: `${prefix}-west-${centerY}`, x: westCorridorEdge + width / 2, y: centerY, sizeX: width, sizeY: length, height: 3200 })
    }
    if (corridorSide === 'east' && !overlapsRamp) {
      columns.push({ id: `${prefix}-east-${centerY}`, x: eastCorridorEdge - width / 2, y: centerY, sizeX: width, sizeY: length, height: 3200 })
    }
  }

  return columns
}

// 用两块相互垂直的矩形柱体拼成 L 形转角柱。
// (x, y) 是两条柱臂重叠处的中心；方向参数控制 L 形开口朝向。
function createLColumn(id, x, y, xDirection, yDirection) {
  const armLength = 1500
  const armThickness = 500
  const armOffset = (armLength - armThickness) / 2

  return [
    {
      id: `${id}-horizontal`,
      x: x + xDirection * armOffset,
      y,
      sizeX: armLength,
      sizeY: armThickness,
      height: 3200,
    },
    {
      id: `${id}-vertical`,
      x,
      y: y + yDirection * armOffset,
      sizeX: armThickness,
      sizeY: armLength,
      height: 3200,
    },
  ]
}

// 左右下沉广场的全部柱子。
const columns = [
  // West plaza columns. Each column is listed separately so it can be tuned one by one.
  { id: 'west-plaza-column-north-12750', x: 12750, y: 19525, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'west-plaza-column-south-12750', x: 12750, y: 49475, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'west-plaza-column-north-17750', x: 17750, y: 19525, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'west-plaza-column-south-17750', x: 17750, y: 49475, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'west-plaza-column-north-22750', x: 22750, y: 19525, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'west-plaza-column-south-22750', x: 22750, y: 49475, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'west-plaza-column-north-27750', x: 27750, y: 19525, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'west-plaza-column-south-27750', x: 27750, y: 49475, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'west-plaza-column-north-32750', x: 32750, y: 19525, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'west-plaza-column-south-32750', x: 32750, y: 49475, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'west-plaza-column-west-26750', x: 8525, y: 26750, sizeX: 1000, sizeY: 1500, height: 3200 },
  { id: 'west-plaza-column-west-41750', x: 8525, y: 41750, sizeX: 1000, sizeY: 1500, height: 3200 },
  { id: 'west-plaza-corner-north-horizontal', x: 9025, y: 19525, sizeX: 1500, sizeY: 500, height: 3200 },
  { id: 'west-plaza-corner-north-vertical', x: 8525, y: 20025, sizeX: 500, sizeY: 1500, height: 3200 },
  { id: 'west-plaza-corner-south-horizontal', x: 9025, y: 49475, sizeX: 1500, sizeY: 500, height: 3200 },
  { id: 'west-plaza-corner-south-vertical', x: 8525, y: 48975, sizeX: 500, sizeY: 1500, height: 3200 },

  // East plaza columns. Each column is listed separately so it can be tuned one by one.
  { id: 'east-plaza-column-north-64750', x: 66750, y: 17525, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'east-plaza-column-south-64750', x: 66750, y: 50975, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'east-plaza-column-north-69750', x: 71750, y: 17525, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'east-plaza-column-south-69750', x: 70750, y: 50975, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'east-plaza-column-north-74750', x: 76750, y: 17525, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'east-plaza-column-south-74750', x: 75750, y: 50975, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'east-plaza-column-north-79750', x: 81750, y: 17525, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'east-plaza-column-south-79750', x: 80750, y: 50975, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'east-plaza-column-north-84750', x: 86750, y: 17525, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'east-plaza-column-south-84750', x: 85750, y: 50975, sizeX: 1500, sizeY: 1000, height: 3200 },
  { id: 'east-plaza-column-east-26750', x: 91075, y: 27950, sizeX: 1000, sizeY: 1500, height: 3200 },
  { id: 'east-plaza-column-east-27750', x: 91075, y: 22950, sizeX: 1000, sizeY: 1500, height: 3200 },
  { id: 'east-plaza-column-east-41750', x: 91075, y: 39750, sizeX: 1000, sizeY: 1500, height: 3200 },
  { id: 'east-plaza-column-east-42750', x: 91075, y: 45450, sizeX: 1000, sizeY: 1500, height: 3200 },
   { id: 'east-plaza-column-east-43750', x: 91075, y: 33850, sizeX: 1000, sizeY: 1500, height: 3200 },
  { id: 'east-plaza-corner-north-horizontal', x: 90975, y: 17525, sizeX: 1600, sizeY: 500, height: 3200 },
  { id: 'east-plaza-corner-north-vertical', x: 91475, y: 18525, sizeX: 500, sizeY: 1500, height: 3200 },
  { id: 'east-plaza-corner-south-horizontal', x: 90975, y: 51475, sizeX: 1500, sizeY: 500, height: 3200 },
  { id: 'east-plaza-corner-south-vertical', x: 91475, y: 50975, sizeX: 500, sizeY: 1500, height: 3200 },
]

// 左右缓坡：从走廊标高 0mm 下降到广场标高 -120mm。
const ramps = [
  {
    id: 'ramp-west-hall',
    name: '西侧大厅缓坡',
    x1: 8025,
    y1: 34500,
    x2: 12000,
    y2: 34500,
    width: 8000,
    startElevation: 0,
    endElevation: -120,
    slope: -0.03,
  },
  {
    id: 'ramp-east-hall',
    name: '东侧大厅缓坡',
    x1: 91975,
    y1: 34400,
    x2: 87000,
    y2: 34500,
    width: 10000,
    startElevation: 0,
    endElevation: -120,
    slope: -0.03,
  },
]

// 创建墙体：从 (x1, y1) 延伸至 (x2, y2)。
// 默认墙高 2800mm、厚度 200mm。
// 横墙的 y1/y2 相同；竖墙的 x1/x2 相同。
const wall = (id, x1, y1, x2, y2, height = 2800, thickness = 200) => ({
  id,
  x1,
  y1,
  x2,
  y2,
  height,
  thickness,
})

// 全部墙体。移动横墙时同时修改两个 y；移动竖墙时同时修改两个 x。
const walls = [
  // 左右外侧纵廊的外墙，以及上下两段内墙。
  wall('west-corridor-outer', 3975, 3000, 3975, 67000),
  wall('east-corridor-outer', 96025, 3000, 96025, 67000),
  wall('west-corridor-inner-north', 8025, 3000, 8025, 14975),
  wall('west-corridor-inner-south', 8025, 54025, 8025, 67000),
  wall('east-corridor-inner-north', 91975, 3000, 91975, 12975),
  wall('east-corridor-inner-south', 91975, 54025, 91975, 67000),
  // 左右纵廊顶部和底部的四段封口墙。
  wall('west-corridor-north-cap', 3975, 3000, 8025, 3000),
  wall('east-corridor-north-cap', 91975, 3000, 96025, 3000),
  wall('west-corridor-south-cap', 3975, 67000, 8025, 67000),
  wall('east-corridor-south-cap', 91975, 67000, 96025, 67000),

  // 上、下横廊墙；center-left/right 是中央走廊口左右两侧的短墙。
  wall('top-corridor-north-west', 8025, 14975, 38000, 14975),
  wall('top-corridor-north-east', 62000, 12975, 91975, 12975),
  wall('top-corridor-south-center-left', 39000, 19025, 47975, 19025),
  wall('top-corridor-south-center-right', 52025, 19025, 61000, 19025),
  wall('bottom-corridor-south-west', 8025, 54025, 41000, 54025),
  wall('bottom-corridor-south-center-left', 39000, 50025, 47975, 50025),
  wall('bottom-corridor-south-center-right', 52025, 50025, 61000, 50025),
  wall('bottom-corridor-south-east', 59000, 55025, 91975, 55025),

  // 中央纵廊两侧墙，以及左右广场靠中央区域的纵墙。
  wall('center-corridor-west', 47975, 18975, 47975, 50025),
  wall('center-corridor-east', 52025, 18975, 52025, 50025),
  wall('west-plaza-inner-wall', 39000, 19025, 39000, 49975),
  wall('east-plaza-inner-wall', 61000, 19025, 61000, 49975),

  // 北侧、南侧大厅围墙。
  wall('north-hall-west', 38000, 3000, 38000, 14975),
  wall('north-hall-north', 38000, 3000, 62000, 3000),
  wall('north-hall-east', 62000, 3000, 62000, 14975),
  wall('south-hall-west', 41000, 54025, 41000, 67000),
  wall('south-hall-south', 41000, 67000, 59000, 67000),
  wall('south-hall-east', 59000, 54025, 59000, 67000),

]

// 创建巡检点：坐标 (x, y)、朝向 yaw、识别目标 targets。
const point = (id, name, x, y, yaw, targets) => ({
  id,
  name,
  targetName: name,
  x,
  y,
  yaw,
  recognitionTargets: targets,
})

// 实验楼一层固定巡检点。
const inspectionPoints = [
  point('LAB-P01', '北侧中点', 50000, 17000, 'east', ['定位标识', '通道占用']),
  point('LAB-P02', '北侧东段', 72000, 17000, 'east', ['人员检测', '消防设施']),
  point('LAB-P03', '东北转角', 94000, 17000, 'south', ['门状态', '通道占用']),
  point('LAB-P04', '东侧中段', 94000, 34500, 'south', ['门状态', '消防设施']),
  point('LAB-P05', '东南转角', 94000, 52000, 'west', ['通道占用', '消防设施']),
  point('LAB-P06', '南侧东段', 72000, 52000, 'west', ['人员检测', '通道占用']),
  point('LAB-P07', '南侧中点', 50000, 52000, 'north', ['定位标识', '消防设施']),
  point('LAB-P08', '中央走廊中段', 50000, 34500, 'north', ['人员检测', '通道占用']),
  point('LAB-P09', '北侧西段', 28000, 17000, 'west', ['人员检测', '通道占用']),
  point('LAB-P10', '西北转角', 6000, 17000, 'south', ['人员检测', '消防设施']),
  point('LAB-P11', '西侧中段', 6000, 34500, 'south', ['门状态', '通道占用']),
  point('LAB-P12', '西南转角', 6000, 52000, 'east', ['门状态', '消防设施']),
]

// 巡检任务只保存需要停靠的目标点。两个目标点之间如果需要经过走廊转角，
// 在这里补充仅用于路线绘制和回放的通行节点，避免界面用直线穿过房间。
const routeTransitions = {
  'LAB-P08->LAB-P09': [
    { id: 'LAB-VIA-NORTH-CENTER', x: 50000, y: 17000 },
  ],
}

// 完整地图数据，供新建计划预览和 3D 巡检页面共同使用。
export const labBuildingMap = {
  id: 'lab-building-floor-1',
  sceneId: 'lab-building',
  name: '实验楼一层',
  source: {
    type: 'slam-over-plan',
    name: '实验楼一层 first_floor SLAM 地图',
    note: '当前导航图只覆盖实验楼左半区；右半区模型先作为消防平面图参考，后续完整建图后再统一校准。',
  },
  slamMap: {
    imageUrl: '/maps/first_floor.png',
    imageSize: { width: 790, height: 1360 },
    transform: {
      flipX: false,
      flipY: false,
    },
    yaml: {
      resolution: 0.05,
      origin: [-14.482376, -55.031775, 0],
      source: '/home/nano1/indoor_patrol_maps/first_floor.yaml',
    },
    coverage: {
      x: 60000,
      y: 3000,
      width: 39000,
      depth: 64000,
      label: 'first_floor 当前导航覆盖区',
    },
    placement: {
      x: 60000,
      y: 3000,
      width: 39000,
      depth: 64000,
    },
    modelCalibration: {
      enabled: false,
      source: { x: 3000, y: 3000, width: 39000, depth: 64000 },
      target: 'coverage',
      objectIds: [
        'corridor-west',
        'top-corridor-north-west',
        'bottom-corridor-south-west',
        'west-corridor-outer',
        'west-corridor-inner-north',
        'west-corridor-inner-south',
        'west-corridor-north-cap',
        'west-corridor-south-cap',
        'west-plaza-inner-wall',
        'hall-west',
        'ramp-west-hall',
      ],
      objectIdPrefixes: [
        'west-plaza-column',
        'west-plaza-corner',
      ],
      inspectionPointIds: ['LAB-P09', 'LAB-P10', 'LAB-P11', 'LAB-P12'],
    },
  },
  size: {
    width: 100000,
    height: 70000,
    unit: 'mm',
  },
  corridorWidth: 4050,
  floorHeight: 3200,
  walls,
  corridors,
  halls,
  ramps,
  columns,
  landmarkLines: [],
  cabinets: [],
  entrances: [
    { id: 'lab-entry-south', name: '南侧主入口', x: 50000, y: 69000 },
    { id: 'lab-entry-west', name: '西侧入口', x: 6000, y: 34500 },
  ],
  inspectionPoints,
  routeTransitions,
  routes: [
    {
      id: 'lab-floor-loop',
      name: '实验楼一层环廊巡检',
      roomId: 'lab-building-floor-1',
      area: '实验楼一层 / 环形走廊',
      robot: 'nano1',
      priority: '高',
      estimatedMinutes: 28,
      pointIds: inspectionPoints.map((item) => item.id),
    },
  ],
}

export const labInspectionPointById = Object.fromEntries(
  labBuildingMap.inspectionPoints.map((item) => [item.id, item]),
)
