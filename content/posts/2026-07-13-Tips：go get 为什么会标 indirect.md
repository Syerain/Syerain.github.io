---
title: go get 为什么会标 indirect
slug: 2026-07-13-Tips：go get 为什么会标 indirect
date: 2026-07-13 09:00:00
category: tips
tags: []
excerpt: 起因是刚开始学 go，发现项目 go.mod 里的包默认都标了 // indirect
---

起因是某次发现项目 `go.mod` 里的包默认都标了 `// indirect`

百思不得其解，后来发现，每次加新包时 `go get` 都是显然跑在实际调用之前，所以当 `go get` 拿到包之后，代码还没开始写呢，所以包就被标成 indirect 了...

也算是过度依赖 ide 各种自动补全的表现？
