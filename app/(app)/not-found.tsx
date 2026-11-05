import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="card p-5">
      <h1 className="text-xl font-semibold">Registro não encontrado</h1>
      <p className="mt-2 text-[15px] text-muted">O código pode ter mudado na planilha ou o endereço está incompleto.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/custos" className="btn btn-primary">
          Ver custos
        </Link>
        <Link href="/busca" className="btn btn-secondary">
          Buscar
        </Link>
      </div>
    </div>
  )
}
