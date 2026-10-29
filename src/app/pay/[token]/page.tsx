export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="bg-white rounded-lg shadow p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-[#12243A]">Invoice</h1>
            <p className="text-gray-600">Kivunra</p>
          </div>
          <div className="mb-6">
            <p className="text-gray-500">Invoice link: {token}</p>
            <p className="text-center text-gray-600 mt-8">
              PayPal payment integration coming soon
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
