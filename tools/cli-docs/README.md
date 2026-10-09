# CLI reference → field help

`public/cli-docs.js` is generated from the *Hammerspace Command Line Reference* PDF. It holds every CLI command with its options, and maps each command to the API operations it corresponds to and each option to the API field or parameter it sets.

To regenerate it for a new release:

```bash
pdftotext -layout Hammerspace-5.x-Command-Line-Reference.pdf ref.txt   # poppler-utils
python3 parse.py ref.txt     # -> cli.json (commands and options)
python3 build.py             # -> ../../public/cli-docs.js; prints options it couldn't map
```

- `map.py` lists which API operations each CLI command corresponds to. Add new commands there.
- `ALIAS` in `build.py` covers options whose name differs from the API field, e.g. `--description` → `comment` and `--size` → `shareSizeLimit`.
- Options that can't be mapped to a field still appear in the operation's **Command-line equivalent** card.
