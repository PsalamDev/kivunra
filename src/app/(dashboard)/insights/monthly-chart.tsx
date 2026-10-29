'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatMoney } from '@/lib/format'

export interface MonthlyPoint {
  month: string
  invoiced: number
  collected: number
}

export function MonthlyChart({ data, currency }: { data: MonthlyPoint[]; currency: string }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} />
          <YAxis
            width={90}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatMoney(currency, Number(value))}
          />
          <Tooltip formatter={(value) => formatMoney(currency, Number(value))} />
          <Legend />
          <Bar dataKey="invoiced" name="Invoiced" fill="#12243A" radius={[4, 4, 0, 0]} />
          <Bar dataKey="collected" name="Collected" fill="#0EA58B" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
