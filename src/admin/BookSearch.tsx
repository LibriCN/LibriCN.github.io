import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen, CircleAlert, LoaderCircle, Search, X } from 'lucide-react'
import { apiConfigured, externalBooks } from '../api'
import type { BookSearchProvider, ExternalBookResult } from '../api'
import type { Book } from '../types'

export function BookThumbnail({ book }: { book: { title: string; coverUrl: string } }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [book.coverUrl])
  return book.coverUrl && !failed
    ? <img className="admin-book-cover" src={book.coverUrl} alt={`Capa de ${book.title}`} loading="lazy" onError={() => setFailed(true)} />
    : <span className="admin-book-cover admin-cover-empty" aria-label="Capa indisponível"><BookOpen size={22} /></span>
}

export function BookIdentity({ book }: { book: Pick<Book, 'title' | 'authors' | 'coverUrl' | 'isbn'> & { publicationYear: number | null; recordType?: 'work' | 'edition'; externalId?: string; source?: string } }) {
  return <><BookThumbnail book={book} /><span className="book-identity"><strong>{book.title}</strong>{book.source && <small>{book.source}</small>}<span>{book.authors.join(', ') || 'Autor não informado'}</span><small>{book.publicationYear || 'Ano não informado'} <span aria-hidden="true">·</span> {book.isbn ? `ISBN ${book.isbn}` : 'ISBN não informado'}</small>{book.recordType && <small className="record-identity">{book.recordType === 'work' ? 'Obra · edição não confirmada' : 'Edição identificada'}{book.externalId && ` · ${book.externalId}`}</small>}</span></>
}

export function BookSearch({ books, onSelect, onManual, disabled = false }: {
  books: Book[]
  onSelect: (book: Book | ExternalBookResult, local: boolean) => void
  onManual?: () => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<BookSearchProvider>('auto')
  const [results, setResults] = useState<ExternalBookResult[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState('')
  const [error, setError] = useState('')
  const [source, setSource] = useState<'catalog' | 'external'>('external')
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const localResults = query.trim() ? books.filter(book => `${book.title} ${book.authors.join(' ')} ${book.isbn}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))).slice(0, 20) : []
  const runSearch = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || disabled || source === 'catalog' || !query.trim()) return
    const current = ++generation.current
    setBusy(true); setError(''); setResults([]); setSearched('')
    try {
      if (!apiConfigured) throw new Error('A busca externa precisa de uma API conectada. Você pode cadastrar manualmente.')
      const response = await externalBooks(query, provider)
      if (current === generation.current) { setResults(response.data); setSearched(query.trim()) }
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Não foi possível buscar. Tente novamente.') }
    finally { if (current === generation.current) setBusy(false) }
  }
  const changeQuery = (value: string) => { generation.current++; setQuery(value); setBusy(false); setResults([]); setSearched(''); setError('') }
  return <div className="book-finder">
    <div className="finder-tabs" role="group" aria-label="Onde buscar"><button type="button" className={source === 'external' ? 'active' : ''} onClick={() => setSource('external')}>Buscar livro</button><button type="button" className={source === 'catalog' ? 'active' : ''} onClick={() => setSource('catalog')}>Já está no acervo <span>{books.length}</span></button></div>
    <form className="finder-form" onSubmit={event => void runSearch(event)}>
      {source === 'external' && <label className="finder-provider" htmlFor="book-search-provider">Base de pesquisa<select id="book-search-provider" value={provider} disabled={disabled} onChange={event => { generation.current++; setProvider(event.target.value as BookSearchProvider); setResults([]); setSearched(''); setError(''); setBusy(false) }}><option value="auto">Automática · Open Library + Big Book</option><option value="openlibrary">Open Library</option><option value="bigbook">Big Book</option></select></label>}
      <label htmlFor="book-finder-query">{source === 'catalog' ? 'Buscar entre os livros cadastrados' : 'Título, autor, ISBN ou ID da Open Library'}</label>
      <div className="finder-input"><Search size={20} /><input id="book-finder-query" value={query} onChange={event => changeQuery(event.target.value)} placeholder="Qual livro você tem em mãos?" enterKeyHint="search" autoComplete="off" disabled={disabled} />{query && <button className="icon-button" type="button" aria-label="Limpar busca" onClick={() => changeQuery('')}><X size={17} /></button>}{source === 'external' && <button className="button button-primary" disabled={busy || disabled || !query.trim()}>{busy ? <LoaderCircle size={18} className="spin" /> : <Search size={18} />}<span>{busy ? 'Buscando' : 'Buscar'}</span></button>}</div>
    </form>
    <p className="finder-hint">{source === 'catalog' ? 'Resultados instantâneos. Reutilize o cadastro e adicione a localização.' : 'Use o ISBN para encontrar a edição exata. Confira a capa e o autor antes de escolher.'}</p>
    {busy && <div className="finder-loading" role="status"><LoaderCircle className="spin" size={20} /><div><strong>Procurando nas bases de livros…</strong><span>A primeira consulta pode levar alguns segundos. Buscas repetidas usam o cache.</span></div></div>}
    {error && <div className="form-error" role="alert"><CircleAlert size={18} /><span>{error}</span><button className="button button-secondary" type="button" onClick={event => void runSearch(event)}>Tentar novamente</button></div>}
    {source === 'external' && searched && !busy && <div className="finder-result-heading"><strong>{results.length ? 'Confira e escolha a edição' : 'Nenhum livro encontrado'}</strong><span>{results.length ? `${results.length} opções para “${searched}”` : 'Tente outro título, autor ou o ISBN.'}</span></div>}
    <div className="finder-results" aria-live="polite">{source === 'external' ? results.map((book, index) => <button type="button" className="finder-result" key={`${book.externalId || book.isbn}-${index}`} disabled={disabled} onClick={() => onSelect(book, false)}><BookIdentity book={book} /><ArrowRight size={19} /></button>) : localResults.map(book => <button type="button" className="finder-result" key={book.id} disabled={disabled} onClick={() => onSelect(book, true)}><BookIdentity book={book} /><span className="finder-local-tag">No acervo</span><ArrowRight size={19} /></button>)}</div>
    {source === 'catalog' && query.trim() && !localResults.length && <p className="empty-inline">Nenhum cadastro com esse termo. Use “Buscar livro” para consultar a base externa.</p>}
    {onManual && <button type="button" className="finder-manual" onClick={onManual}>Não encontrou a edição? Cadastrar manualmente <ArrowRight size={15} /></button>}
  </div>
}
