<script>
  import FanSlider from './components/FanSlider.svelte';
  import HeaterSlider from './components/HeaterSlider.svelte';
  import TemperatureReadout from './components/TemperatureReadout.svelte';
  import RoastGraph from './components/RoastGraph.svelte';
  import EventButtons from './components/EventButtons.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import RoastSettingsDialog from './components/RoastSettingsDialog.svelte';
  import { startRoast, stopRoast, resetRoast } from './store.js';

  let activePanel = 'home';
  let showStart = true;
  let showStop = false;
  let showReset = false;

  function startRoast1() {
    startRoast();
    showStart = false;
    showStop = true;
    activePanel = 'roasting';
  }

  function stopRoast1() {
    stopRoast();
    showStop = false;
    showReset = true;
  }

  function reset() {
    resetRoast();
    showReset = false;
    showStart = true;
    activePanel = 'home';
  }

  const panels = [
    { id: 'home', label: 'Home', description: 'Overview & quick actions' },
    { id: 'roasting', label: 'Roasting', description: 'Live controls & roast events' },
    { id: 'update', label: 'Update', description: 'Device and roast settings' }
  ];
</script>

<div class="app-shell">
  <aside class="side-nav">
    <div class="brand">
      <p class="eyebrow">Yaeger</p>
      <h1>Roast Console</h1>
    </div>

    <nav>
      {#each panels as panel}
        <button
          class:active={activePanel === panel.id}
          on:click={() => (activePanel = panel.id)}
        >
          <span>{panel.label}</span>
          <small>{panel.description}</small>
        </button>
      {/each}
    </nav>
  </aside>

  <main class="content">
    {#if activePanel === 'home'}
      <section class="panel">
        <header>
          <h2>Home</h2>
          <p>Monitor current roast temperature and quickly start a session.</p>
        </header>

        <div class="card-grid">
          <article class="card">
            <h3>Current Temperature</h3>
            <TemperatureReadout />
          </article>

          <article class="card">
            <h3>Session Control</h3>
            {#if showStart}
              <button class="primary" on:click={startRoast1}>Start Roast</button>
            {:else if showStop}
              <button class="danger" on:click={stopRoast1}>Stop Roast</button>
            {:else if showReset}
              <button class="secondary" on:click={reset}>Reset Session</button>
            {/if}
          </article>
        </div>
      </section>
    {/if}

    {#if activePanel === 'roasting'}
      <section class="panel">
        <header>
          <h2>Roasting</h2>
          <p>Adjust fan and heater output while tracking the roast curve.</p>
        </header>

        <div class="card-grid controls">
          <article class="card">
            <h3>Fan</h3>
            <FanSlider />
          </article>

          <article class="card">
            <h3>Heater</h3>
            <HeaterSlider />
          </article>
        </div>

        <article class="card chart">
          <h3>Roast Graph</h3>
          <RoastGraph />
        </article>

        <article class="card">
          <h3>Event Markers</h3>
          <EventButtons />
        </article>
      </section>
    {/if}

    {#if activePanel === 'update'}
      <section class="panel">
        <header>
          <h2>Update</h2>
          <p>Manage device setup and roast profile defaults.</p>
        </header>

        <div class="card-grid">
          <article class="card">
            <h3>Device Settings</h3>
            <p>Open and apply network or system-level updates.</p>
            <SettingsDialog />
          </article>

          <article class="card">
            <h3>Roast Settings</h3>
            <p>Adjust profile details and roast metadata defaults.</p>
            <RoastSettingsDialog />
          </article>
        </div>
      </section>
    {/if}
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background: radial-gradient(circle at top, #1f2937, #0b1020 45%);
    color: #e5e7eb;
  }

  .app-shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 280px 1fr;
  }

  .side-nav {
    padding: 1.5rem;
    backdrop-filter: blur(12px);
    background: rgba(15, 23, 42, 0.84);
    border-right: 1px solid rgba(148, 163, 184, 0.2);
  }

  .brand h1 {
    margin: 0;
    font-size: 1.5rem;
  }

  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #93c5fd;
    font-size: 0.75rem;
  }

  nav {
    margin-top: 2rem;
    display: grid;
    gap: 0.8rem;
  }

  nav button {
    text-align: left;
    width: 100%;
    padding: 0.8rem 0.9rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(100, 116, 139, 0.35);
    background: rgba(15, 23, 42, 0.5);
    color: #cbd5e1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    cursor: pointer;
    margin: 0;
  }

  nav button small {
    color: #94a3b8;
  }

  nav button.active {
    background: linear-gradient(135deg, #1d4ed8, #2563eb);
    border-color: rgba(191, 219, 254, 0.4);
    color: white;
  }

  nav button.active small {
    color: #dbeafe;
  }

  .content {
    padding: 2rem;
  }

  .panel {
    max-width: 1100px;
  }

  header h2 {
    margin: 0;
    font-size: 1.8rem;
  }

  header p {
    margin-top: 0.5rem;
    color: #94a3b8;
  }

  .card-grid {
    margin-top: 1.2rem;
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }

  .controls {
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  }

  .card {
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 1rem;
    padding: 1rem 1.1rem;
    box-shadow: 0 12px 36px rgba(2, 6, 23, 0.35);
  }

  .card h3 {
    margin: 0 0 0.8rem;
    font-size: 1rem;
    color: #dbeafe;
  }

  .chart {
    margin-top: 1rem;
  }

  .primary,
  .danger,
  .secondary {
    border: 0;
    padding: 0.65rem 1rem;
    border-radius: 0.65rem;
    font-weight: 600;
    cursor: pointer;
  }

  .primary {
    background: linear-gradient(135deg, #16a34a, #22c55e);
    color: #f0fdf4;
  }

  .danger {
    background: linear-gradient(135deg, #b91c1c, #ef4444);
    color: #fef2f2;
  }

  .secondary {
    background: linear-gradient(135deg, #334155, #475569);
    color: #e2e8f0;
  }

  @media (max-width: 900px) {
    .app-shell {
      grid-template-columns: 1fr;
    }

    .side-nav {
      border-right: 0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
    }
  }
</style>
