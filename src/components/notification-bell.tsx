'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'

interface NotificationItem {
  id: string
  type: string
  title: string
  body: string | null
  source_type: string | null
  source_id: string | null
  read_at: string | null
  created_at: string
}

function formatWhen(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function hrefFor(notification: NotificationItem): string | null {
  if (notification.source_type === 'Invoice' && notification.source_id) {
    return `/invoices/${notification.source_id}`
  }

  return null
}

/**
 * In-app notification bell. Polls once on mount and re-fetches when the
 * dropdown opens, keeping the unread badge reasonably fresh without a socket.
 */
export function NotificationBell() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return

      const data = (await res.json()) as {
        notifications?: NotificationItem[]
        unread?: number
      }

      setItems(data.notifications ?? [])
      setUnread(data.unread ?? 0)
    } catch (error) {
      console.error('Error loading notifications:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!open) return

    load()

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open, load])

  const markAllRead = async () => {
    const previous = unread
    setUnread(0)
    setItems((current) =>
      current.map((item) => ({
        ...item,
        read_at: item.read_at ?? new Date().toISOString(),
      }))
    )

    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('mark all read failed')
    } catch (error) {
      console.error('Error marking notifications read:', error)
      setUnread(previous)
      load()
    }
  }

  const markOneRead = async (id: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item
      )
    )
    setUnread((current) => Math.max(0, current - 1))

    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    } catch (error) {
      console.error('Error marking notification read:', error)
      load()
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex items-center justify-center rounded-md p-1.5 hover:text-[#0EA58B] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA58B]"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] rounded-full bg-[#0EA58B] px-1 text-[10px] font-semibold leading-[18px] text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-gray-200 bg-white text-gray-800 shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-semibold text-[#12243A]">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-[#0EA58B] hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">
                You&apos;re all caught up.
              </p>
            ) : (
              <ul className="divide-y">
                {items.map((item) => {
                  const href = hrefFor(item)
                  const content = (
                    <div className={item.read_at ? 'opacity-70' : undefined}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-[#12243A]">{item.title}</p>
                        {!item.read_at && (
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#0EA58B]" />
                        )}
                      </div>
                      {item.body && <p className="mt-0.5 text-xs text-gray-600">{item.body}</p>}
                      <p className="mt-1 text-[11px] text-gray-400">
                        {formatWhen(item.created_at)}
                      </p>
                    </div>
                  )

                  return (
                    <li key={item.id}>
                      {href ? (
                        <Link
                          href={href}
                          onClick={() => markOneRead(item.id)}
                          className="block px-4 py-3 hover:bg-gray-50"
                        >
                          {content}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => markOneRead(item.id)}
                          className="block w-full px-4 py-3 text-left hover:bg-gray-50"
                        >
                          {content}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
