<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/clunkyard/.github/main/profile/assets/lockup-reverse.svg">
  <img alt="Clunkyard" src="https://raw.githubusercontent.com/clunkyard/.github/main/profile/assets/lockup.svg" width="360">
</picture>

### Build a robot. Outthink the field.

Clunkyard is robot combat in 2D and 3D. Write the tactics, watch your robot
scan, move and fire, then read the replay and improve your next decision.

Start with a working robot in Vane, Cadence or Glyph, or use the SDK in a
language you already know. There are starters for 56 language profiles.

| Your next move | Start here |
| --- | --- |
| Put your first robot in the arena | [Five-minute tutorial](https://clunkyard.com/getting-started) |
| Pick a language or programming model | [Language-choice guide](https://clunkyard.com/manual#choose-language) |
| Read the robot API and examples | [SDK reference](https://clunkyard.com/sdk) |
| Develop in your own editor | [Language starters and local game kit](https://github.com/clunkyard/game-kit) |
| Clone and push your private robot | [Private Git setup](https://clunkyard.com/sdk/private-git) |
| Compare a change in a real match | [Local trials and replays](https://clunkyard.com/sdk/local-trials) |
| Learn the rules, classes and competition | [Game manual](https://clunkyard.com/manual) |

The [public SDK repository](https://github.com/clunkyard/sdk) contains the robot
API, WebAssembly core source and developer tools. Install the reviewed player
packages from npm:

| Package | Use it for |
| --- | --- |
| [@clunkyard/cli](https://www.npmjs.com/package/@clunkyard/cli) | Create projects, build robots, connect remote code and play real local matches with your installed toolchain |
| [@clunkyard/sdk](https://www.npmjs.com/package/@clunkyard/sdk) | JavaScript and TypeScript robots, with the shared WebAssembly core |
| [@clunkyard/git](https://www.npmjs.com/package/@clunkyard/git) | Clone and push your private Clunkyard project with Git |

Create a Vane robot and play a local match with Node 20+ and npm:

```sh
npx @clunkyard/cli new vane my-robot
cd my-robot
npx @clunkyard/cli build
npx @clunkyard/cli match
```

The [local development guide](https://clunkyard.com/sdk/player-kit) covers other
languages, toolchain requirements and saved replays.

For setup questions and tactics, join the
[shared community discussions](https://github.com/clunkyard/game-kit/discussions).

**[Play Clunkyard](https://clunkyard.com)** ·
[Contribution guide](https://github.com/clunkyard/.github/blob/main/CONTRIBUTING.md) ·
[Help and bug reports](https://github.com/clunkyard/.github/blob/main/SUPPORT.md)
