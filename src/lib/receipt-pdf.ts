import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

import { formatDate } from './format'
import {
  completedCapturedAmount,
  invoiceAmountDue,
  refundedAmount,
  roundMoneyValue,
  type PublicInvoice,
  type PublicInvoiceCapture,
} from './public-invoice'

/**
 * A downloadable PDF receipt for a paid invoice.
 *
 * It deliberately mirrors the public receipt page: issuer, invoice details,
 * each completed payment with any refund, and the totals. The standard PDF
 * fonts only cover WinAnsi, so text is sanitised (and money uses a code prefix
 * for currencies whose symbol is outside that encoding, such as NGN).
 */

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 50
const BOTTOM_MARGIN = 56
const ROW_HEIGHT = 20
const FOOTER_Y = 30

const INK = rgb(0.07, 0.14, 0.23)
const MUTED = rgb(0.42, 0.45, 0.5)
const ACCENT = rgb(0.055, 0.647, 0.545)
const RULE = rgb(0.9, 0.91, 0.93)

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
}

/** Characters outside WinAnsi that the standard PDF fonts can still render. */
const WIN_ANSI_EXTRAS = new Set([
  '€', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', 'Ž',
  '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', 'ž', 'Ÿ',
])

function pdfText(value: string): string {
  let output = ''

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    output += code <= 0xff || WIN_ANSI_EXTRAS.has(character) ? character : '?'
  }

  return output
}

export function formatReceiptMoney(currency: string, amount: number): string {
  const code = currency.toUpperCase()
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))
  const symbol = CURRENCY_SYMBOLS[code]
  const body = symbol ? `${symbol}${formatted}` : `${code} ${formatted}`

  return amount < 0 ? `-${body}` : body
}

function fitText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const safe = pdfText(text)

  if (font.widthOfTextAtSize(safe, size) <= maxWidth) {
    return safe
  }

  let trimmed = safe

  while (trimmed.length > 1 && font.widthOfTextAtSize(`${trimmed}...`, size) > maxWidth) {
    trimmed = trimmed.slice(0, -1)
  }

  return `${trimmed}...`
}

function drawRight(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  right: number,
  y: number,
  color = INK
): void {
  const safe = pdfText(text)
  page.drawText(safe, {
    x: right - font.widthOfTextAtSize(safe, size),
    y,
    size,
    font,
    color,
  })
}

function line(page: PDFPage, y: number, color = RULE): void {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color,
  })
}

interface ReceiptContext {
  journalName: string
  font: PDFFont
  bold: PDFFont
  invoice: PublicInvoice
  invoiceTotal: number
  capturedTotal: number
  refundedTotal: number
  netPaid: number
  amountDue: number
}

/** Page heading, invoice details and column headers. Returns the first row baseline. */
function drawPageHeader(page: PDFPage, context: ReceiptContext, continued: boolean): number {
  const { journalName, font, bold, invoice, amountDue } = context

  page.drawText(fitText(bold, journalName, 20, PAGE_WIDTH - MARGIN * 2 - 160), {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN,
    size: 20,
    font: bold,
    color: INK,
  })

  drawRight(page, 'PAYMENT RECEIPT', bold, 9, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - MARGIN + 2, ACCENT)
  line(page, PAGE_HEIGHT - MARGIN - 12)

  if (continued) {
    drawRight(page, `${invoice.invoice_number} (continued)`, font, 10, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - MARGIN - 34, MUTED)
  } else {
    page.drawText(fitText(bold, `Receipt for ${invoice.invoice_number}`, 16, PAGE_WIDTH - MARGIN * 2), {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - 34,
      size: 16,
      font: bold,
      color: INK,
    })
    page.drawText(pdfText(`Invoice issued ${formatDate(invoice.created_at)}`), {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - 52,
      size: 10,
      font,
      color: MUTED,
    })

    page.drawText('BILLED TO', {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - 82,
      size: 8,
      font: bold,
      color: MUTED,
    })
    page.drawText(fitText(font, invoice.customers?.name ?? 'Customer', 11, 260), {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - 98,
      size: 11,
      font,
      color: INK,
    })

    drawRight(page, 'STATUS', bold, 8, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - MARGIN - 82, MUTED)
    drawRight(
      page,
      amountDue > 0.01 ? 'Partially paid' : 'Paid in full',
      bold,
      11,
      PAGE_WIDTH - MARGIN,
      PAGE_HEIGHT - MARGIN - 98,
      INK
    )
  }

  const headerY = PAGE_HEIGHT - MARGIN - (continued ? 66 : 128)
  page.drawText('DATE', { x: MARGIN, y: headerY, size: 8, font: bold, color: MUTED })
  drawRight(page, 'PAYMENT', bold, 8, PAGE_WIDTH - MARGIN - 110, headerY, MUTED)
  drawRight(page, 'REFUNDED', bold, 8, PAGE_WIDTH - MARGIN, headerY, MUTED)
  line(page, headerY - 8)

  return headerY - 26
}

function drawRow(page: PDFPage, context: ReceiptContext, capture: PublicInvoiceCapture, y: number): void {
  const { font, invoice } = context
  const refunded = (capture.payment_refunds ?? [])
    .filter((refund) => refund.status === 'COMPLETED')
    .reduce((sum, refund) => sum + Number(refund.amount ?? 0), 0)

  page.drawText(pdfText(formatDate(capture.captured_at ?? null)), {
    x: MARGIN,
    y,
    size: 10,
    font,
    color: INK,
  })
  drawRight(
    page,
    formatReceiptMoney(invoice.currency, Number(capture.amount ?? 0)),
    font,
    10,
    PAGE_WIDTH - MARGIN - 110,
    y,
    INK
  )
  drawRight(
    page,
    refunded > 0 ? formatReceiptMoney(invoice.currency, -roundMoneyValue(refunded)) : '-',
    font,
    10,
    PAGE_WIDTH - MARGIN,
    y,
    refunded > 0 ? INK : MUTED
  )
}

function drawTotals(page: PDFPage, context: ReceiptContext, startY: number): void {
  const { font, bold, invoice, invoiceTotal, capturedTotal, refundedTotal, netPaid, amountDue } = context
  const labelX = PAGE_WIDTH - MARGIN - 250
  const valueRight = PAGE_WIDTH - MARGIN
  let y = startY - 16

  line(page, y + 8)

  const plainRow = (label: string, value: number) => {
    page.drawText(label, { x: labelX, y, size: 10, font, color: MUTED })
    drawRight(page, formatReceiptMoney(invoice.currency, value), font, 10, valueRight, y, INK)
    y -= 18
  }

  plainRow('Invoice total', invoiceTotal)
  plainRow('Payments received', capturedTotal)

  if (refundedTotal > 0) {
    plainRow('Refunds', -refundedTotal)
  }

  line(page, y + 8)

  page.drawText('Net paid', { x: labelX, y, size: 11, font: bold, color: INK })
  drawRight(page, formatReceiptMoney(invoice.currency, netPaid), bold, 11, valueRight, y, ACCENT)
  y -= 20

  page.drawText('Amount due', { x: labelX, y, size: 11, font: bold, color: INK })
  drawRight(page, formatReceiptMoney(invoice.currency, amountDue), bold, 11, valueRight, y, INK)
}

function drawFooter(page: PDFPage, context: ReceiptContext, generatedAt: Date, pageNumber: number, pageCount: number): void {
  const { font } = context

  page.drawText('Secured by Kivunra', { x: MARGIN, y: FOOTER_Y, size: 8, font, color: MUTED })
  page.drawText(pdfText(`Generated ${formatDate(generatedAt.toISOString())}`), {
    x: MARGIN,
    y: FOOTER_Y - 12,
    size: 8,
    font,
    color: MUTED,
  })
  drawRight(page, `Page ${pageNumber} of ${pageCount}`, font, 8, PAGE_WIDTH - MARGIN, FOOTER_Y, MUTED)
}

export interface BuildReceiptInput {
  journalName: string
  invoice: PublicInvoice
  captures: PublicInvoiceCapture[]
  generatedAt?: Date
}

export async function buildReceiptPdf({
  journalName,
  invoice,
  captures,
  generatedAt = new Date(),
}: BuildReceiptInput): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)

  document.setTitle(pdfText(`Receipt ${invoice.invoice_number}`))
  document.setAuthor(pdfText(journalName))
  document.setSubject('Payment receipt')
  document.setCreator('Kivunra')
  document.setProducer('Kivunra')

  const invoiceTotal = Number(invoice.total ?? 0)
  const capturedTotal = completedCapturedAmount(invoice)
  const refundedTotal = refundedAmount(invoice)
  const netPaid = roundMoneyValue(Math.max(0, capturedTotal - refundedTotal))
  const amountDue = invoiceAmountDue(invoice)

  const context: ReceiptContext = {
    journalName,
    font,
    bold,
    invoice,
    invoiceTotal,
    capturedTotal,
    refundedTotal,
    netPaid,
    amountDue,
  }

  // The first page has the most chrome, so it decides the chunk size.
  const firstRowY = PAGE_HEIGHT - MARGIN - 154
  const reservedForTotals = 170
  const rowsPerPage = Math.max(
    1,
    Math.floor((firstRowY - BOTTOM_MARGIN - reservedForTotals) / ROW_HEIGHT)
  )
  const chunks: PublicInvoiceCapture[][] = []

  for (let index = 0; index < captures.length; index += rowsPerPage) {
    chunks.push(captures.slice(index, index + rowsPerPage))
  }

  if (chunks.length === 0) {
    chunks.push([])
  }

  chunks.forEach((chunk, chunkIndex) => {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    let y = drawPageHeader(page, context, chunkIndex > 0)

    if (chunk.length === 0) {
      page.drawText('No completed payments are recorded.', {
        x: MARGIN,
        y,
        size: 10,
        font,
        color: MUTED,
      })
      y -= ROW_HEIGHT
    }

    for (const capture of chunk) {
      drawRow(page, context, capture, y)
      y -= ROW_HEIGHT
    }

    if (chunkIndex === chunks.length - 1 || chunk.length === 0) {
      drawTotals(page, context, y)
    }

    drawFooter(page, context, generatedAt, chunkIndex + 1, chunks.length)
  })

  return document.save()
}
