'use client'

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card p-5" role="alert">
      <h1 className="text-xl font-semibold">Não foi possível carregar esta tela</h1>
      <p className="mt-2 text-[15px] text-muted">{error.message || 'Erro inesperado.'}</p>
      {error.digest && <p className="mt-1 text-[12px] text-muted">Código: {error.digest}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">
          Tentar novamente
        </button>
        <a href="/" className="btn btn-secondary">
          Ir para Visão geral
        </a>
      </div>
    </div>
  )
}
