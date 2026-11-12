let selected = "";
export const setTournamentContext = (id) => {
  selected = id || "";
};
export const tournamentHeaders = () =>
  selected ? { "X-DLAR-Tournament": selected } : {};
