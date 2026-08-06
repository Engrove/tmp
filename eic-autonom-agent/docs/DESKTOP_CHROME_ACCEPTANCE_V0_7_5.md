# Desktop Chrome-acceptans — v0.7.5

Status: **inte automatiskt verifierad i installerad Chrome-runtime**.

## A. Starta Ny Session använder vald förberedd flik

1. Installera v0.7.5.
2. Öppna en ChatGPT-session manuellt.
3. Förbered sessionen till önskat EIC-läge.
4. Koppla och välj fliken i addonen.
5. Klicka **Starta Ny Session**.
6. Verifiera att ingen ny flik skapas.
7. Verifiera att prompten levereras exakt en gång i den valda fliken.

## B. Systematisk granskning använder samma flik

1. Förbered en EIC-session manuellt.
2. Koppla och välj fliken.
3. Ange testbehov och kontext.
4. Klicka **Starta systematisk granskning**.
5. Verifiera att ingen ny flik skapas.
6. Verifiera att `EIC_APP_AUDIT_REQUEST/1` levereras i den valda fliken.

## C. Saknad förberedelse failar stängt

1. Välj ingen kopplad flik.
2. Klicka någon av startknapparna.
3. Verifiera felmeddelandet: koppla och välj den förberedda sessionens flik.
4. Verifiera att ingen flik skapas eller navigeras.

## D. Busy target lämnas orört

1. Låt den valda ChatGPT-sessionen generera.
2. Klicka en startknapp.
3. Verifiera att ingen prompt injiceras.
4. Verifiera att den pågående generationen inte stoppas.

## E. Root-query promotion

1. Öppna `https://chatgpt.com/?model=...`.
2. Koppla och välj fliken.
3. Starta en körning.
4. När ChatGPT navigerar till `/c/<id>`, verifiera att runnen promoveras och inte går till `TAB_NAVIGATED_AWAY`.

## F. Audit innerText

1. Kör minst ett verkligt auditevent.
2. Verifiera att quoted historisk trailer inte orsakar `EVENT_AFTER_TRAILER`.
3. Verifiera att ett malformed auditevent rapporteras men inte fyller Nano-prompten.
