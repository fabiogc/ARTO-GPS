#!/bin/sh
set -e
# Banco e relatórios legíveis só pelo usuário do serviço
umask 077
# Recusa subir sem autenticação configurada: dados de custos são sensíveis.
if [ -z "$SESSION_SECRET" ] || [ ${#SESSION_SECRET} -lt 32 ]; then
  echo "ERRO: defina SESSION_SECRET (mín. 32 caracteres)." >&2; exit 1
fi
if [ -z "$ADMIN_PASSWORD_HASH" ]; then
  echo "ERRO: defina ADMIN_PASSWORD_HASH (npm run hash-password -- \"senha\")." >&2; exit 1
fi
# Primeira execução: importa a planilha colocada no volume, se o banco ainda não existir.
if [ ! -f "$DATABASE_PATH" ]; then
  if [ -f "$V4_XLSX_PATH" ]; then
    echo "Banco não encontrado — importando $V4_XLSX_PATH"
    npx tsx scripts/import-v4.ts --file "$V4_XLSX_PATH" --db "$DATABASE_PATH"
  else
    echo "AVISO: sem banco e sem planilha em $V4_XLSX_PATH. Envie a planilha pela tela Mais › Importar após o primeiro login" >&2
    echo "       ou copie-a para o volume e reinicie." >&2
  fi
fi
exec "$@"
