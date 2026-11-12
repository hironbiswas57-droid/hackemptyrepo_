import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, AudioLines, BookOpen, Brain, Check, ChevronDown, CircleHelp, Compass, Flower2, Heart, LockKeyhole, Menu, MessageCircle, Moon, Plus, Send, ShieldCheck, Sparkles, Sun, Wind, X } from 'lucide-react';

const starterPrompts = ['I feel a little overwhelmed today', 'Help me wind down for sleep', 'I want to understand my anxiety'];
const features = [
  { icon: MessageCircle, title: 'A space to untangle things', text: 'Talk through a hard moment, name what is coming up, and find one gentle next step.' },
  { icon: BookOpen, title: 'Grounded, useful learning', text: 'Explore clear, approachable information about emotions, habits, sleep and wellbeing.' },
  { icon: Compass, title: 'Small practices, at your pace', text: 'Try a breathing reset, a journal prompt or a wind-down routine that fits today.' },
];

function App() {
  const [screen, setScreen] = useState('home');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [account, setAccount] = useState(null);
  const [accountMode, setAccountMode] = useState('register');
  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '' });
  const [memoryConsent, setMemoryConsent] = useState(false);
  const [authError, setAuthError] = useState('');
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' }).then(async (r) => {
      if (!r.ok) return;
      const data = await r.json(); setAccount(data.user);
      if (data.user.memoryEnabled) {
        const memoryResponse = await fetch('/api/memory', { credentials: 'same-origin' });
        if (memoryResponse.ok) {
          const saved = await memoryResponse.json();
          setMessages(saved.interactions.map((item) => ({ role: item.role === 'assistant' ? 'bot' : 'user', text: item.content })));
        }
      }
    }).catch(() => {});
  }, []);

  const startChat = (prompt = '') => { setScreen('chat'); if (prompt) sendMessage(prompt); };
  const voiceIntro = () => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setNotice('Voice playback is not supported by this browser. You can still read the introduction here.');
      return;
    }
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const intro = new SpeechSynthesisUtterance('Hi, I’m Stillwell. I’m an AI wellbeing companion, not a therapist or a doctor. I can help you reflect, explore general wellbeing information, or try a gentle grounding exercise. We can take things one step at a time. What would feel helpful today?');
    intro.rate = 0.94;
    intro.onend = () => setSpeaking(false);
    intro.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(intro);
    setSpeaking(true);
  };
  const sendMessage = async (text = message) => {
    const clean = text.trim(); if (!clean) return;
    if (sending) return;
    const history = [...messages, { role: 'user', content: clean }];
    setMessages(m => [...m, { role: 'user', text: clean }]); setMessage('');
    setSending(true);
    try {
      const body = account?.memoryEnabled
        ? { message: clean }
        : { messages: history.map((item) => ({ role: item.role === 'bot' ? 'assistant' : item.role, content: item.content || item.text })) };
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/chat`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The reply could not be generated.');
      setMessages(m => [...m, { role: 'bot', text: data.reply }]);
    } catch (error) {
      setMessages(m => [...m, { role: 'bot', text: error.message || 'The chat service is unavailable. Please try again.' }]);
    } finally { setSending(false); }
  };
  const submitAuth = async (event) => {
    event.preventDefault(); setAuthError('');
    try {
      const response = await fetch(`/api/auth/${accountMode}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...authForm, memoryConsent }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Account request failed.');
      setAccount(data.user); setAuthError('');
      if (data.user.memoryEnabled) {
        const memoryResponse = await fetch('/api/memory', { credentials: 'same-origin' });
        if (memoryResponse.ok) { const saved = await memoryResponse.json(); setMessages(saved.interactions.map((item) => ({ role: item.role === 'assistant' ? 'bot' : 'user', text: item.content }))); }
      }
    } catch (error) { setAuthError(error.message || 'Could not connect to the account service.'); }
  };
  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    setAccount(null); setMessages([]); go('home');
  };
  const clearMemory = async () => {
    if (!window.confirm('Delete all saved conversation messages for this account? This cannot be undone in the app.')) return;
    const response = await fetch('/api/memory', { method: 'DELETE', credentials: 'same-origin' });
    if (response.ok) { setMessages([]); setNotice('Saved conversation memory was deleted.'); }
  };
  const setMemoryEnabled = async (enabled) => {
    const response = await fetch('/api/memory/consent', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    if (response.ok) { setAccount((current) => ({ ...current, memoryEnabled: enabled })); if (!enabled) setMessages([]); setNotice(enabled ? 'Encrypted memory enabled.' : 'New conversations will not be saved.'); }
  };
  const deleteAccount = async () => {
    if (!window.confirm('Delete this account and its saved messages? This cannot be undone in the app.')) return;
    const response = await fetch('/api/account', { method: 'DELETE', credentials: 'same-origin' });
    if (response.ok) { setAccount(null); setMessages([]); go('home'); }
  };
  const go = (next) => { setScreen(next); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => go('home')} aria-label="Stillwell home"><span className="brand-mark"><Flower2 size={20}/></span><span>stillwell</span></button>
      <nav className={menuOpen ? 'nav open' : 'nav'}>
        <button onClick={() => go('home')}>Home</button><a href="#how" onClick={() => setMenuOpen(false)}>How it works</a><button onClick={() => go('library')}>Explore</button>
      </nav>
      <div className="nav-actions"><button className="profile-link" onClick={() => go('account')}><span className="avatar">{account?.name?.[0] || account?.email?.[0] || String.fromCharCode(74)}</span><span>My space</span></button><button className="menu-toggle" onClick={() => setMenuOpen(v => !v)} aria-label="Toggle menu">{menuOpen ? <X/> : <Menu/>}</button></div>
    </header>

    {screen === 'home' && <main>
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot"/> A softer place to land</div><h1>A little more<br/><span>room to feel.</span></h1><p className="hero-lede">A thoughtful companion for the moments when you need to pause, make sense of things, or find your next small step.</p><div className="hero-actions"><button className="button button-primary" onClick={() => startChat()}>Start a conversation <ArrowRight size={17}/></button><a href="#how" className="text-link">Get to know Stillwell <ArrowDown size={15}/></a></div><button className="voice-intro-button" onClick={voiceIntro} aria-pressed={speaking}><span className="voice-duck"><svg viewBox="0 0 48 48" role="img" aria-label="Duck companion"><ellipse cx="24" cy="28" rx="16" ry="14" fill="#fffdf8" stroke="#554c5f" strokeWidth="1.5"/><circle cx="26" cy="15" r="11" fill="#fffdf8" stroke="#554c5f" strokeWidth="1.5"/><circle cx="29" cy="14" r="1.5" fill="#302d3a"/><path d="M35 18h9l-7 5z" fill="#efbe51" stroke="#c89332" strokeWidth="1"/><path d="M18 7q8-7 15 0" fill="none" stroke="#806caa" strokeWidth="3" strokeLinecap="round"/><path d="M13 32q11 9 23 0" fill="none" stroke="#806caa" strokeWidth="4" strokeLinecap="round"/><path d="M15 42v3m17-3v3" stroke="#e8b948" strokeWidth="3" strokeLinecap="round"/></svg></span><span className="voice-intro-copy"><strong>{speaking ? 'Stillwell is speaking…' : 'Meet your little guide'}</strong><small>{speaking ? 'Tap to stop the introduction' : 'Listen to a short spoken welcome'}</small></span><span className="voice-play"><AudioLines size={18}/></span></button><div className="hero-trust"><span className="trust-icon"><LockKeyhole size={14}/></span> Memory is encrypted when you opt in</div></div>
        <div className="hero-art" aria-label="Illustration of a calm, sunny landscape"><div className="sun-disc"/><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hill hill-back"/><div className="hill hill-front"/><div className="art-card"><span className="art-card-icon"><Wind size={16}/></span><div><strong>Take a breath</strong><small>There’s no rush here.</small></div><span className="pulse-dot"/></div><div className="art-caption">A moment, just for you <Sparkles size={14}/></div><div className="duck-in-scene" aria-hidden="true"><svg viewBox="0 0 100 112"><ellipse cx="50" cy="72" rx="29" ry="31" fill="#fffdf8" stroke="#594d65" strokeWidth="2"/><circle cx="54" cy="34" r="23" fill="#fffdf8" stroke="#594d65" strokeWidth="2"/><path d="M70 39h23L75 50z" fill="#f0c354" stroke="#be9136" strokeWidth="1.5"/><circle cx="62" cy="33" r="2.3" fill="#302d3a"/><path d="M36 17q18-22 36 0" fill="none" stroke="#806caa" strokeWidth="5" strokeLinecap="round"/><path d="M28 68q21 19 44 0" fill="none" stroke="#806caa" strokeWidth="8" strokeLinecap="round"/><path d="M36 100v7m27-7v7" stroke="#e7b94c" strokeWidth="5" strokeLinecap="round"/><path d="M47 68q-15 6-15 20" fill="none" stroke="#e6e0ec" strokeWidth="3" strokeLinecap="round"/></svg></div></div>
      </section>
      <section className="intro-strip"><div className="strip-mark"><Heart size={19}/></div><p>Life can feel like a lot. <strong>You don’t have to figure it all out at once.</strong></p><span className="strip-spark">✳</span></section>
      <section id="how" className="features-section"><div className="section-heading"><div><div className="eyebrow">A little support, shaped around you</div><h2>What would feel helpful?</h2></div><p>Start wherever you are. There’s no perfect way to use this space.</p></div><div className="feature-grid">{features.map(({icon:Icon,title,text},i)=><article className="feature-card" key={title}><div className={`feature-icon feature-icon-${i}`}><Icon size={20}/></div><h3>{title}</h3><p>{text}</p><button className="card-link" onClick={() => i === 1 ? go('library') : startChat()}>{i === 1 ? 'Browse the library' : 'Try it out'} <ArrowUpRight size={15}/></button><span className="card-number">0{i+1}</span></article>)}</div></section>
      <section className="prompt-band"><div className="prompt-copy"><span className="eyebrow">A place to begin</span><h2>What’s on your mind?</h2><p>Pick a prompt or simply say hello.</p></div><div className="prompt-list">{starterPrompts.map((p,i)=><button key={p} onClick={() => startChat(p)}><span className="prompt-num">0{i+1}</span>{p}<ArrowRight size={16}/></button>)}</div></section>
      <section className="safety-note"><div className="safety-symbol"><ShieldCheck size={20}/></div><div><strong>Supportive, with clear boundaries.</strong><p>Stillwell is an AI wellbeing companion, not a therapist or a crisis service. It doesn’t diagnose or replace professional care. If you’re in immediate danger, contact your local emergency number or a crisis service in your area.</p></div><button onClick={() => go('about')} aria-label="Learn about safety"><ArrowUpRight size={18}/></button></section>
    </main>}

    {screen === 'chat' && <main className="chat-page"><div className="chat-layout"><aside className="chat-side"><button className="back-link" onClick={() => go('home')}><ArrowLeft size={16}/> Back to home</button><div className="side-title"><span className="chat-logo"><Flower2 size={19}/></span><div><b>Your space</b><small>A private moment to reflect</small></div></div><button className="new-chat" onClick={() => {setMessages([]);setNotice('New conversation started.')}}><Plus size={16}/> New conversation</button><div className="side-divider"/><p className="side-label">SUGGESTED STARTERS</p>{starterPrompts.map((p,i)=><button className="side-prompt" key={p} onClick={() => sendMessage(p)}><span>{['◌','☾','↗'][i]}</span>{p}</button>)}<div className="side-bottom"><LockKeyhole size={14}/> {account?.memoryEnabled ? 'Your opted-in memory is encrypted' : 'Guest chats are not saved'}</div></aside><section className="chat-panel"><div className="chat-head"><div><div className="eyebrow"><span className="eyebrow-dot"/> HERE WITH YOU</div><h2>A space to talk</h2></div><button className="icon-button" onClick={() => go('about')} aria-label="About this assistant"><CircleHelp size={19}/></button></div><div className="chat-scroll"><div className="welcome-message"><div className="bot-avatar"><Flower2 size={20}/></div><div className="message-content"><span className="message-name">Stillwell <small>just now</small></span><div className="bubble bot-bubble"><p>Hi, I’m glad you’re here. This can be a space to pause, reflect, or explore something you’ve been carrying.</p><p>What’s been on your mind lately?</p></div></div></div>{messages.map((m,i)=><div className={`message-row ${m.role}`} key={i}>{m.role==='bot'&&<div className="bot-avatar"><Flower2 size={20}/></div>}<div className="message-content"><span className="message-name">{m.role==='bot'?'Stillwell':'You'} <small>just now</small></span><div className={`bubble ${m.role==='bot'?'bot-bubble':'user-bubble'}`}>{m.text}</div></div></div>)}</div><div className="chat-compose"><div className="privacy-inline"><LockKeyhole size={12}/> Your message is processed by Hugging Face; opted-in account memory is encrypted</div><form onSubmit={e=>{e.preventDefault();sendMessage();}}><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Write whatever feels right…" aria-label="Your message"/><button type="submit" disabled={!message.trim() || sending} aria-label="Send message"><Send size={17}/></button></form><p className="chat-disclaimer">Stillwell is an AI companion, not a substitute for professional mental health care.</p></div></section><aside className="chat-insight"><div className="insight-top"><span className="insight-icon"><Sun size={17}/></span><span>TAKE A MOMENT</span></div><h3>A gentle reset</h3><p>Let your shoulders drop. Breathe in slowly, then let the exhale be a little longer.</p><div className="breath-orb"><span/><Wind size={22}/></div><button className="breath-button" onClick={()=>setNotice('Try breathing in for 4 counts, then out for 6. Repeat a few times at a comfortable pace.')}>Try a breathing pause <ArrowRight size={14}/></button><div className="insight-divider"/><div className="chat-resource"><BookOpen size={17}/><div><b>Need more support?</b><small>See trusted resources</small></div><button onClick={()=>go('library')}><ArrowUpRight size={16}/></button></div></aside></div></main>}

    {screen === 'library' && <main className="content-page"><button className="back-link" onClick={()=>go('home')}><ArrowLeft size={16}/> Back</button><div className="eyebrow">Explore at your own pace</div><h1 className="page-title">A little knowledge<br/><span>can make room.</span></h1><p className="page-intro">Gentle, general information to help you understand what you might be experiencing. This is educational, not a diagnosis or treatment plan.</p><div className="library-grid">{[{icon:Moon,title:'Sleep & rest',text:'Build a calmer wind-down and learn about the rhythms of sleep.'},{icon:Brain,title:'Understanding anxiety',text:'Explore how worry can show up in thoughts, feelings and the body.'},{icon:Heart,title:'Emotional wellbeing',text:'A gentle guide to noticing emotions without judging yourself.'},{icon:Wind,title:'Grounding practices',text:'Simple exercises to reconnect with the present moment.'}].map(({icon:Icon,title,text})=><article className="library-card" key={title}><div className="feature-icon"><Icon size={20}/></div><h3>{title}</h3><p>{text}</p><button className="card-link" onClick={()=>startChat(`I'd like to learn about ${title.toLowerCase()}`)}>Explore together <ArrowRight size={15}/></button></article>)}</div><div className="source-note"><ShieldCheck size={19}/><p><b>Careful, open learning.</b> We aim to use reputable public health sources and explain uncertainty plainly. Information here can’t replace advice from a qualified clinician who knows your situation.</p></div></main>}

    {screen === 'account' && <main className="account-page"><div className="account-card account-wide"><div className="account-mark"><LockKeyhole size={22}/></div><div className="eyebrow">Your space, your choice</div>{account ? <><h1>Memory & security</h1><p>Signed in as <b>{account.email}</b>. Messages saved to your account are encrypted before they reach the database. They are used only to provide context for your own future chats.</p><div className="account-info"><ShieldCheck size={18}/><span><b>Memory is {account.memoryEnabled ? 'on' : 'off'}</b><small>{account.memoryEnabled ? 'New registered chats are saved with encryption and can be deleted below.' : 'New chats are not saved. Turn memory on only if you want this account to retain conversations.'}</small></span></div><label className="consent-row"><input type="checkbox" checked={account.memoryEnabled} onChange={e=>setMemoryEnabled(e.target.checked)}/><span>Save my conversations as encrypted account memory</span></label><div className="account-actions"><button className="button button-secondary" onClick={clearMemory}>Delete saved conversations</button><button className="button button-secondary" onClick={signOut}>Sign out</button></div><button className="account-delete" onClick={deleteAccount}>Delete my account and saved data</button></> : <><h1>{accountMode === 'register' ? 'Create your account' : 'Welcome back'}</h1><p>{accountMode === 'register' ? 'Choose whether you want Stillwell to remember your conversations for your own future sessions.' : 'Sign in to continue to your private memory space.'}</p><form className="account-form" onSubmit={submitAuth}><label>Email address<input type="email" autoComplete="email" required maxLength="254" value={authForm.email} onChange={e=>setAuthForm({...authForm,email:e.target.value})}/></label>{accountMode === 'register'&&<label>Display name <span>(optional)</span><input autoComplete="name" maxLength="80" value={authForm.name} onChange={e=>setAuthForm({...authForm,name:e.target.value})}/></label>}<label>Password<input type="password" autoComplete={accountMode==='register'?'new-password':'current-password'} minLength="12" maxLength="128" required value={authForm.password} onChange={e=>setAuthForm({...authForm,password:e.target.value})}/><small>Use at least 12 characters. Passwords are hashed; the original is never stored.</small></label>{accountMode==='register'&&<><label className="consent-row"><input type="checkbox" required checked={memoryConsent} onChange={e=>setMemoryConsent(e.target.checked)}/><span>I agree to save my conversations as encrypted memory for my own account. I can turn this off or delete them later.</span></label><p className="provider-notice">Messages sent for AI replies are processed by Hugging Face Inference Providers. Do not include information you do not want sent to that service. Conversations are not used to train or fine-tune a shared model.</p></>}<button className="button button-primary full-width" type="submit">{accountMode==='register'?'Create account':'Sign in'} <ArrowRight size={16}/></button>{authError&&<p className="auth-error" role="alert">{authError}</p>}</form><button className="account-back" onClick={()=>{setAccountMode(accountMode==='register'?'login':'register');setAuthError('');}}>{accountMode==='register'?'Already have an account? Sign in':'Need an account? Create one'}</button></>}<button className="account-back" onClick={()=>go('home')}>Return to Stillwell</button></div></main>}

    {screen === 'about' && <main className="content-page about-page"><button className="back-link" onClick={()=>go('chat')}><ArrowLeft size={16}/> Back to your space</button><div className="eyebrow">A clear and caring boundary</div><h1 className="page-title">Here to support.<br/><span>Not to replace care.</span></h1><p className="page-intro">Stillwell is an AI companion for reflection and general wellbeing information. It is not a psychologist, doctor or emergency service. It cannot diagnose a condition or create a treatment plan.</p><div className="about-grid"><article><ShieldCheck/><h3>Your privacy</h3><p>Opted-in account conversations are encrypted in the local database and can be deleted from your account. Messages used to generate replies are sent to Hugging Face Inference Providers. Avoid sharing details you do not want that provider to process.</p></article><article><Heart/><h3>Professional support</h3><p>If something is affecting your daily life, a licensed mental health professional can offer care tailored to you. You deserve support from a real person.</p></article><article><CircleHelp/><h3>Urgent help</h3><p>If you may hurt yourself or someone else, or are in immediate danger, contact your local emergency number or a crisis service in your region now.</p></article></div></main>}

    <footer className="footer"><button className="brand footer-brand" onClick={()=>go('home')}><span className="brand-mark"><Flower2 size={17}/></span><span>stillwell</span></button><span>Make a little room for yourself.</span><div><button onClick={()=>go('about')}>About & safety</button><button onClick={()=>go('account')}>Privacy & account</button></div><small>© 2025 Stillwell</small></footer>
    {notice && <div className="toast" role="status"><span><Check size={16}/></span>{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss"><X size={16}/></button></div>}
  </div>;
}

export default App;
