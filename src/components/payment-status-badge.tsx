const STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-800',
  PENDING: 'bg-amber-100 text-amber-800',
  CREATED: 'bg-blue-100 text-blue-800',
  DECLINED: 'bg-red-100 text-red-800',
  FAILED: 'bg-red-100 text-red-800',
  REFUNDED: 'bg-gray-200 text-gray-600',
}

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'Completed',
  PENDING: 'Pending',
  CREATED: 'Created',
  DECLINED: 'Declined',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
}

export function PaymentStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
        STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-800'
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}
