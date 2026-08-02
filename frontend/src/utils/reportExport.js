function text(value, fallback = '--') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function escapeHtml(value) {
  return text(value, '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]))
}

function safeFileName(value) {
  return text(value, '巡检报告').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || '巡检报告'
}

function resultRows(results) {
  if (!results.length) {
    return '<tr><td colspan="7" class="empty">本次巡检没有上传 AI 识别结果。</td></tr>'
  }

  return results.map((result) => `
    <tr>
      <td>${escapeHtml(result.targetName)}</td>
      <td>${escapeHtml(result.recognitionType)}</td>
      <td>${escapeHtml(result.value)}</td>
      <td>${escapeHtml(result.standardRange)}</td>
      <td>${escapeHtml(result.confidence)}</td>
      <td class="${['异常', '告警'].includes(result.status) ? 'abnormal' : ''}">${escapeHtml(result.status)}</td>
      <td>${escapeHtml(result.reviewStatus)}</td>
    </tr>
  `).join('')
}

function timelineRows(timeline) {
  if (!timeline.length) return '<li>未记录执行时间线。</li>'
  return timeline.map((item) => `<li><time>${escapeHtml(item.time)}</time><span>${escapeHtml(item.label)}</span></li>`).join('')
}

function evidenceImages(images) {
  if (!images.length) return '<p class="empty">本次巡检没有关联图片证据。</p>'
  return `<div class="evidence-grid">${images.map((image, index) => `
    <figure>
      <img src="${escapeHtml(image.fileUrl)}" alt="巡检证据 ${index + 1}" />
      <figcaption>${escapeHtml(image.pointId || `证据图片 ${index + 1}`)} · ${escapeHtml(image.capturedAt)}</figcaption>
    </figure>
  `).join('')}</div>`
}

export function downloadInspectionReport(report) {
  const results = report.recognitionResults || []
  const images = report.images || []
  const timeline = report.timeline || []
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false })
  const abnormalResults = results.filter((item) => ['异常', '告警'].includes(item.status))
  const reportHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(report.reportNo)} - 巡检报告</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: #172636; background: #f4f7fa; font: 14px/1.6 "Microsoft YaHei", Arial, sans-serif; }
    main { width: min(1120px, calc(100% - 48px)); margin: 28px auto; padding: 42px 48px; background: #fff; box-shadow: 0 4px 24px #13263a1c; }
    header { border-bottom: 3px solid #0d7b98; padding-bottom: 18px; }
    h1 { margin: 0; color: #0b5067; font-size: 28px; }
    .subtitle { color: #56707e; margin: 5px 0 0; }
    .report-no { float: right; color: #0d7b98; font-weight: 700; }
    h2 { margin: 30px 0 12px; color: #0b5067; font-size: 18px; border-left: 4px solid #19a4bd; padding-left: 10px; }
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 22px; margin: 0; }
    .meta div { padding: 8px 0; border-bottom: 1px solid #e5edf1; }
    dt { color: #627782; font-size: 12px; } dd { margin: 2px 0 0; font-weight: 600; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .kpis article { border: 1px solid #dce9ed; background: #f8fcfd; padding: 14px; border-radius: 4px; }
    .kpis span { display: block; color: #60747e; font-size: 12px; } .kpis strong { color: #075a72; font-size: 24px; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #dce6ea; padding: 8px 10px; text-align: left; vertical-align: top; } th { background: #eaf6f8; color: #0b5067; } .abnormal { color: #c43d36; font-weight: 700; } .empty { color: #70838b; text-align: center; padding: 18px; }
    .timeline { margin: 0; padding: 0; list-style: none; border-left: 2px solid #1aa2ba; } .timeline li { display: flex; gap: 18px; padding: 4px 0 10px 16px; } .timeline time { min-width: 72px; color: #0d7b98; font-weight: 700; }
    .evidence-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; } figure { margin: 0; border: 1px solid #dce6ea; padding: 7px; } img { width: 100%; height: 150px; object-fit: cover; background: #edf2f4; } figcaption { color: #5d717b; font-size: 12px; padding-top: 5px; }
    footer { border-top: 1px solid #dce6ea; margin-top: 34px; padding-top: 12px; color: #71828a; font-size: 12px; }
    @media print { body { background: #fff; } main { width: 100%; margin: 0; box-shadow: none; padding: 18mm; } }
  </style>
</head>
<body>
  <main>
    <header>
      <span class="report-no">${escapeHtml(report.reportNo)}</span>
      <h1>电房设备智能巡检报告</h1>
      <p class="subtitle">由系统后端巡检档案、AI 识别结果和图片证据生成</p>
    </header>
    <h2>任务概况</h2>
    <dl class="meta">
      <div><dt>巡检任务</dt><dd>${escapeHtml(report.name)}</dd></div>
      <div><dt>巡检区域</dt><dd>${escapeHtml(report.area)}</dd></div>
      <div><dt>执行机器人</dt><dd>${escapeHtml(report.robot)}</dd></div>
      <div><dt>巡检路线</dt><dd>${escapeHtml(report.routeName)}</dd></div>
      <div><dt>开始时间</dt><dd>${escapeHtml(report.start)}</dd></div>
      <div><dt>结束时间</dt><dd>${escapeHtml(report.endTime)}</dd></div>
      <div><dt>巡检用时</dt><dd>${escapeHtml(report.duration)}</dd></div>
      <div><dt>任务结论</dt><dd>${escapeHtml(report.status)}</dd></div>
      <div><dt>复核状态</dt><dd>${escapeHtml(report.reviewState)}</dd></div>
    </dl>
    <h2>巡检统计</h2>
    <section class="kpis">
      <article><span>巡检点位</span><strong>${escapeHtml(report.detail?.currentPoint)} / ${escapeHtml(report.detail?.pointTotal)}</strong></article>
      <article><span>AI 识别记录</span><strong>${results.length}</strong></article>
      <article><span>异常 / 告警</span><strong>${abnormalResults.length}</strong></article>
      <article><span>图片证据</span><strong>${images.length}</strong></article>
    </section>
    <h2>AI 识别结果</h2>
    <table><thead><tr><th>巡检对象</th><th>识别类型</th><th>识别值</th><th>标准范围</th><th>置信度</th><th>状态</th><th>复核</th></tr></thead><tbody>${resultRows(results)}</tbody></table>
    <h2>执行过程</h2>
    <ol class="timeline">${timelineRows(timeline)}</ol>
    <h2>图片证据</h2>
    ${evidenceImages(images)}
    <footer>报告生成时间：${escapeHtml(generatedAt)}。本报告为系统导出文件，数据以导出时后端巡检档案为准。</footer>
  </main>
</body>
</html>`
  const blob = new Blob([reportHtml], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const fileName = `${safeFileName(report.reportNo)}-${safeFileName(report.name)}.html`
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return fileName
}
