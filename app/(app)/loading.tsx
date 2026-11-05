export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <div className="skeleton mb-2 h-8 w-2/3" />
      <div className="skeleton mb-6 h-4 w-1/2" />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24" />
        ))}
      </div>
      <div className="skeleton mt-6 h-40" />
    </div>
  )
}
