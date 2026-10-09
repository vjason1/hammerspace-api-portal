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

## Per-release data

`public/cli-docs.js` holds one data set per release (`CLI_DOCS_BY_VERSION`). The portal shows the active cluster's release.

```bash
./build_all.sh Hammerspace-5.3-Command-Line-Reference.pdf clihelp-5.2.txt clihelp-5.3.txt
```

- For 5.2, the build uses the 5.2 CLI help and keeps only the commands and options that release has. Descriptions from the reference guide are still used where they match.
- For 5.3, it uses the 5.3 CLI help plus the 5.3 reference guide.
- To add a release, add its help file and a `RELEASE=x.y python3 build.py` step to `build_all.sh`.
