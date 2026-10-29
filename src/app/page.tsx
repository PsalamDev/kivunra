export default function Home() {
  return (
    <main className="min-h-screen bg-[#12243A] text-white">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl font-bold mb-4">Kivunra</h1>
          <p className="text-xl text-gray-300 mb-8">Move Smarter. Manage Better.</p>
          <p className="text-lg mb-12 text-gray-200">
            AI-powered financial management and payment workflow for freelancers, 
            independent creators, and small businesses.
          </p>
          <div className="flex gap-4 justify-center">
            <a 
              href="/login" 
              className="bg-[#0EA58B] hover:bg-[#0c9479] text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Get Started
            </a>
            <a 
              href="/dashboard" 
              className="bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Dashboard
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
