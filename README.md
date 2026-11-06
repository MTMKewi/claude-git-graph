# git-graph

Claude Code için bir mod: sohbetin yanında duran bir panelde bir git deposunun commit ağacını gösterir. Dallar, merge'ler ve etiketler renkli şeritlerle ya da `git log --graph` metniyle çizilir.

## Kurulum

Bir terminal oturumunun komut satırında:

```text
/plugin install git-graph --marketplace MTMKewi/claude-git-graph
```

Kabuktan:

```bash
claude plugin install git-graph --marketplace MTMKewi/claude-git-graph
```

Masaüstü uygulamasında `/plugin` çalışmaz: komut kutusunun yanındaki + düğmesine tıkla, Plugins'i seç, Add marketplace ile `MTMKewi/claude-git-graph` adresini ekle, sonra Add plugin'e tıkla.

## Kullanım

- Panel oturum başında açılır. Kapatırsan ya da pencere dar olduğu için açılmazsa mesaj kutusuna `/git-graph` yaz.
- Başlangıçta oturumun klasörünü gösterir. **Yol** alanına başka bir depo yolu yazıp açabilirsin. Açtığın depolar **Depo** listesinde kalır ve son seçimin hatırlanır.
- Grafik 15 saniyede bir yerel depodan yenilenir. **Yenile** hemen yeniler.
- **Fetch** `git fetch --all` çalıştırır. Uzak depoya yalnızca bu düğme bağlanır.
- **Renkli grafik** ve **Metin grafik** görünümler arasında geçiş yapar. Renkli görünümde **A−** ve **A+** boyutu değiştirir.
