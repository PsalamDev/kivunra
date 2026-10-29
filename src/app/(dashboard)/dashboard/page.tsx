export default function DashboardPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h2 className="text-2xl font-bold text-[#12243A] mb-6">Dashboard</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-gray-500 text-sm">Total Income</h3>
          <p className="text-2xl font-bold text-[#12243A]">$0.00</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-gray-500 text-sm">Outstanding Invoices</h3>
          <p className="text-2xl font-bold text-[#12243A]">0</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-gray-500 text-sm">Paid Invoices</h3>
          <p className="text-2xl font-bold text-[#12243A]">0</p>
        </div>
      </div>
      <div className="mt-8 bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-bold text-[#12243A] mb-4">Recent Activity</h3>
        <p className="text-gray-500">No activity yet. Create your first invoice to get started.</p>
      </div>
    </main>
  );
}
