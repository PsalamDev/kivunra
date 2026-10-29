const STATUS_STYLES: Record<string, string> = {
  Paid: 'bg-green-100 text-green-800',
  Published: 'bg-blue-100 text-blue-800',
  PartiallyPaid: 'bg-amber-100 text-amber-800',
  Overdue: 'bg-red-100 text-red-800',
  Draft: 'bg-gray-100 text-gray-800',
  Cancelled: 'bg-gray-200 text-gray-600',
}

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES.Draft
      }${className ? ` ${className}` : ''}`}
    >
      {status}
    </span>
  )
}
