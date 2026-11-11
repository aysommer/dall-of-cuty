// Прогресс игрока за всё время: общие типы для клиента и сервера.
// (Прокачку характеристик убрали — её переделают позже.)

export interface Profile {
  kills: number;
  /** Смертей за всё время — для соотношения убийств и смертей */
  deaths: number;
}

export function newProfile(): Profile {
  return { kills: 0, deaths: 0 };
}
