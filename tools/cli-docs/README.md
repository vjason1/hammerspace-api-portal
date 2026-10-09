# CLI reference → field help

`public/cli-docs.js` is generated from the *Hammerspace Command Line Reference* PDF. It holds every CLI command with its options, and maps each command to the API operations it corresponds to and each option to the API field or parameter it sets.

To regenerate it for a new release:

```bash
pdftotext -layout Hammerspace-5.x-Command-Line-Reference.pdf ref.txt   # poppler-utils
python3 parse.py ref.txt     # -> cli.json (commands and options from the reference guide)

# Optional but recommended: the CLI's own built-in help from a cluster, current for that release.
# On the cluster, capture every command's help into one file (e.g. "<command> --help" for each command), then:
python3 parse_help.py clihelp.txt   # -> cli_help.json

python3 build.py             # merges both -> ../../public/cli-docs.js; prints options it couldn't map
```

- When both sources describe an option, the built-in help wins. If the reference guide adds detail, its text is appended as *(Reference guide: …)*. Options marked `*` (required) in the help get *(Required)*.
- `map.py` lists which API operations each CLI command corresponds to. Add new commands there.
- `ALIAS` in `build.py` covers options whose name differs from the API field, e.g. `--description` → `comment` and `--size` → `shareSizeLimit`.
- Options that can't be mapped to a field still appear in the operation's **Command-line equivalent** card.
