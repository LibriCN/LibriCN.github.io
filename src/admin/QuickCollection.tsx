import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleAlert, LoaderCircle, MapPin, Minus, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import { apiConfigured, createHolding, importBookSelection, listSections, updateHolding } from '../api'
import type { ExternalBookResult } from '../api'
import { adminUrl } from '../config'
import type { Book, LibraryBook, LibrarySection } from '../types'
import { BookIdentity, BookSearch, BookThumbnail } from './BookSearch'

function readPreferences(): { libraryId?: string; shelfLocation?: string; sectionId?: string } {
  try { return JSON.parse(sessionStorage.getItem('livro-perto-collection') || '{}') } catch { return {} }
}

export function AdminCollectionPage() {
  const { books, setBooks, libraries: cityLibraries, libraryBooks, setLibraryBooks, adminUser } = useApp()
  const libraries = useMemo(() => cityLibraries.filter(library => !adminUser || adminUser.role === 'admin' || adminUser.allLibraries || adminUser.libraryIds.includes(library.id)), [cityLibraries, adminUser])
  const [libraryId, setLibraryId] = useState(() => readPreferences().libraryId || libraries[0]?.id || '')
  const [selected, setSelected] = useState<{ book: Book | ExternalBookResult; local: boolean } | null>(null)
  const [draft, setDraft] = useState(() => ({ quantity: 1, availableQuantity: 1, status: 'disponivel' as LibraryBook['status'], shelfLocation: readPreferences().shelfLocation || '', sectionId: readPreferences().sectionId || '' }))
  const [sections, setSections] = useState<LibrarySection[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sessionCount, setSessionCount] = useState(0)
  const saving = useRef(false)
  const library = libraries.find(item => item.id === libraryId)
  const holding = selected?.local ? libraryBooks.find(item => item.bookId === (selected.book as Book).id && item.libraryId === libraryId) : undefined
  useEffect(() => { if (!libraries.some(item => item.id === libraryId) && libraries.length) setLibraryId(libraries[0].id) }, [libraries, libraryId])
  useEffect(() => {
    let active = true
    setSections(libraries.find(item => item.id === libraryId)?.sections || [])
    if (apiConfigured && libraryId) listSections(libraryId).then(result => { if (active) setSections(result) }).catch(() => undefined)
    return () => { active = false }
  }, [libraryId, libraries])
  useEffect(() => { try { sessionStorage.setItem('livro-perto-collection', JSON.stringify({ libraryId, shelfLocation: draft.shelfLocation, sectionId: draft.sectionId })) } catch { /* preferências são opcionais */ } }, [libraryId, draft.shelfLocation, draft.sectionId])
  const select = (book: Book | ExternalBookResult, local: boolean) => {
    const existing = local ? libraryBooks.find(item => item.bookId === (book as Book).id && item.libraryId === libraryId) : undefined
    setDraft(previous => existing ? { quantity: existing.quantity, availableQuantity: existing.availableQuantity, status: existing.status, shelfLocation: existing.shelfLocation, sectionId: existing.sectionId || '' } : { ...previous, quantity: 1, availableQuantity: 1, status: 'disponivel' })
    setSelected({ book, local }); setError(''); setMessage('')
  }
  const setQuantity = (value: number) => setDraft(previous => ({ ...previous, quantity: Math.max(1, value), availableQuantity: Math.min(Math.max(1, value), previous.availableQuantity) }))
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving.current || !selected || !library) return
    if (!Number.isInteger(draft.quantity) || draft.quantity < 1 || !Number.isInteger(draft.availableQuantity) || draft.availableQuantity < 0 || draft.availableQuantity > draft.quantity) return setError('Confira as quantidades: disponíveis deve estar entre zero e o total de exemplares.')
    saving.current = true; setBusy(true); setError(''); setMessage('')
    const timestamp = new Date().toISOString()
    const payload = { ...draft, libraryId, sectionId: draft.sectionId || undefined, status: draft.availableQuantity > 0 ? 'disponivel' as const : draft.status === 'indisponivel' ? 'indisponivel' as const : 'emprestado' as const }
    try {
      let savedBook: Book
      let savedHolding: LibraryBook
      if (!selected.local) {
        if (!apiConfigured) throw new Error('Conecte a API para importar um livro.')
        const response = await importBookSelection(selected.book as ExternalBookResult, payload)
        savedBook = response
        if (!response.holding) throw new Error('O livro foi importado, mas o serviço não confirmou o exemplar. Tente salvar novamente.')
        savedHolding = response.holding
      } else {
        savedBook = selected.book as Book
        const item: LibraryBook = { ...payload, id: holding?.id || `local-holding-${Date.now()}`, bookId: savedBook.id, lastCheckedAt: timestamp }
        savedHolding = apiConfigured ? await (holding ? updateHolding(item) : createHolding(savedBook.id, item)) as LibraryBook : item
      }
      setBooks(previous => [savedBook, ...previous.filter(item => item.id !== savedBook.id)])
      setLibraryBooks(previous => [...previous.filter(item => !(item.bookId === savedBook.id && item.libraryId === libraryId)), { ...payload, ...savedHolding, bookId: savedBook.id, lastCheckedAt: savedHolding.lastCheckedAt || timestamp }])
      setMessage(`“${savedBook.title}” salvo em ${library.name}.`)
      setSessionCount(previous => previous + 1); setSelected(null)
      requestAnimationFrame(() => document.getElementById('book-finder-query')?.focus())
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Seus dados continuam aqui para tentar novamente.') }
    finally { saving.current = false; setBusy(false) }
  }
  const recent = libraryBooks.filter(item => item.libraryId === libraryId).slice(-5).reverse()
  return <div className="admin-page collection-page">
    <div className="collection-intro"><div><span className="eyebrow">LIVRO EM MÃOS, ACERVO EM DIA</span><h2>Coleta rápida</h2><p>Encontre, confira a edição e salve. Pronto para o próximo.</p></div><span className="session-counter"><Check size={16} /> {sessionCount} nesta sessão</span></div>
    <div className="collection-workspace"><div>
      <section className="collection-panel collection-location"><MapPin size={21} /><label>Você está cadastrando em<select aria-label="Biblioteca da coleta" value={libraryId} disabled={busy} onChange={event => { setLibraryId(event.target.value); setSelected(null); setDraft(previous => ({ ...previous, sectionId: '', shelfLocation: '' })); setError(''); setMessage('') }}><option value="">Escolha a biblioteca</option>{libraries.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></section>
      {!libraries.length && <div className="collection-panel collection-no-library"><BookOpen size={28} /><h3>Comece pela biblioteca</h3><p>Crie o local onde os exemplares serão encontrados.</p><Link className="button button-primary" to={adminUrl('/bibliotecas')}>Ir para bibliotecas <ArrowRight size={17} /></Link></div>}
      {library && <><ol className="collection-steps" aria-label="Etapas do cadastro"><li className={!selected ? 'active' : 'complete'}><span>{selected ? <Check size={14} /> : '1'}</span> Encontrar</li><li className={selected ? 'active' : ''}><span>2</span> Conferir e salvar</li></ol>
      {message && <div className="collection-success" role="status"><Check size={21} /><div><strong>Livro registrado!</strong><span>{message}</span><small>A biblioteca, a seção e a prateleira foram mantidas.</small></div></div>}
      {!selected ? <section className="collection-panel"><BookSearch books={books} onSelect={select} /><Link className="finder-manual" to={`${adminUrl('/livros')}?novo=1`}>Prefere preencher os dados? Cadastro manual <ArrowRight size={15} /></Link></section> : <form className="collection-panel collection-confirm" onSubmit={event => void save(event)}>
        <button className="finder-back" type="button" disabled={busy} onClick={() => setSelected(null)}><ArrowLeft size={16} /> Escolher outro livro</button>
        <div className="selected-book"><BookIdentity book={selected.book} /></div>
        <p className="selected-source">{selected.local ? 'Cadastro existente · sem nova consulta externa' : 'Confira se a capa, o autor e o ISBN correspondem ao seu exemplar.'}</p>
        {holding && <div className="collection-notice">Este livro já está nesta biblioteca. Os valores abaixo atualizam o registro existente.</div>}
        <div className="collection-fields"><label>Total de exemplares<div className="quantity-stepper"><button type="button" aria-label="Diminuir total" disabled={busy || draft.quantity <= 1} onClick={() => setQuantity(draft.quantity - 1)}><Minus size={17} /></button><input aria-label="Total de exemplares" type="number" inputMode="numeric" min="1" step="1" required value={draft.quantity} disabled={busy} onChange={event => setQuantity(Number(event.target.value))} /><button type="button" aria-label="Aumentar total" disabled={busy} onClick={() => setQuantity(draft.quantity + 1)}><Plus size={17} /></button></div></label><label>Disponíveis agora<div className="quantity-stepper"><button type="button" aria-label="Diminuir disponíveis" disabled={busy || draft.availableQuantity <= 0} onClick={() => setDraft(previous => ({ ...previous, availableQuantity: previous.availableQuantity - 1 }))}><Minus size={17} /></button><input aria-label="Disponíveis agora" type="number" inputMode="numeric" min="0" max={draft.quantity} step="1" required value={draft.availableQuantity} disabled={busy} onChange={event => setDraft(previous => ({ ...previous, availableQuantity: Number(event.target.value) }))} /><button type="button" aria-label="Aumentar disponíveis" disabled={busy || draft.availableQuantity >= draft.quantity} onClick={() => setDraft(previous => ({ ...previous, availableQuantity: previous.availableQuantity + 1 }))}><Plus size={17} /></button></div></label>
        {draft.availableQuantity === 0 && <label>Motivo da indisponibilidade<select disabled={busy} value={draft.status === 'indisponivel' ? 'indisponivel' : 'emprestado'} onChange={event => setDraft(previous => ({ ...previous, status: event.target.value as LibraryBook['status'] }))}><option value="emprestado">Emprestado</option><option value="indisponivel">Indisponível</option></select></label>}
        <label>Seção<select value={draft.sectionId} disabled={busy} onChange={event => setDraft(previous => ({ ...previous, sectionId: event.target.value }))}><option value="">Sem seção</option>{sections.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label><label className="shelf-field">Prateleira ou estante<input value={draft.shelfLocation} disabled={busy} placeholder="Ex.: Estante 2 · A-12" onChange={event => setDraft(previous => ({ ...previous, shelfLocation: event.target.value }))} /></label></div>
        {error && <div className="form-error" role="alert"><CircleAlert size={18} />{error}</div>}
        <div className="collection-save-bar"><div><strong>{library.name}</strong><span>{draft.quantity} exemplar{draft.quantity !== 1 ? 'es' : ''} · {draft.availableQuantity} {draft.availableQuantity === 1 ? 'disponível' : 'disponíveis'}</span></div><button className="button button-primary" disabled={busy}>{busy ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}{busy ? 'Salvando registro…' : 'Salvar e próximo'}</button></div>
      </form>}</>}
    </div><aside className="collection-aside"><div className="collection-panel"><span className="eyebrow">NESTA BIBLIOTECA</span><h3>Últimos registros</h3>{recent.length ? <div className="collection-history">{recent.map(item => { const book = books.find(value => value.id === item.bookId); return book && <div key={item.id}><BookThumbnail book={book} /><div><strong>{book.title}</strong><span>{item.quantity} exemplar{item.quantity !== 1 ? 'es' : ''}{item.shelfLocation && ` · ${item.shelfLocation}`}</span></div><Check size={15} /></div> })}</div> : <p className="empty-inline">Os registros aparecerão aqui após salvar.</p>}</div><div className="collection-tip"><BookOpen size={21} /><strong>Uma edição de cada vez</strong><p>O ISBN identifica a edição. Sem ele, compare título, autor e capa antes de salvar.</p></div></aside></div>
  </div>
}
