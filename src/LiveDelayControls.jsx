export default function LiveDelayControls({ delayMs, disabled, onApply }) {
  return (
    <section className="production-card live-delay-controls">
      <h2>Delay for all live graphics</h2>
      <form
        className="production-calibration"
        key={delayMs}
        onSubmit={(event) => {
          event.preventDefault();
          onApply(
            Number(new FormData(event.currentTarget).get("delay")) * 1000,
          );
        }}
      >
        <label>
          Live stats delay (seconds)
          <input
            name="delay"
            type="number"
            min="0"
            max="120"
            step="0.1"
            defaultValue={delayMs / 1000}
            disabled={disabled}
          />
        </label>
        <button className="button primary" disabled={disabled}>
          Save live delay
        </button>
      </form>
      <p>
        One saved target for player statistics, the souls graph, ultimate
        interactions, bridge buffs and live API panels. It carries across games
        in this tournament. Studio graphics use the same delayed outputs as OBS.
      </p>
      <p className="production-hint">
        Allow one full delay interval after opening a source or changing the
        target. Recording-timeline buffering smooths arrival bursts; packets
        that arrive too late appear when available. Match the gameplay delay in
        OBS to this target.
      </p>
    </section>
  );
}
