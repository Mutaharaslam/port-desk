import Foundation

/// Runs the bundled Node server and reports where it is listening.
///
/// The server gets a stdin pipe that only this process holds. When the app exits for any
/// reason, the pipe closes and the server exits with it, so no orphan is left behind.
final class NodeServer {
    enum State {
        case starting
        case running(URL)
        case failed(String)
    }

    private(set) var state: State = .starting {
        didSet { onChange?(state) }
    }
    var onChange: ((State) -> Void)?

    private let node: URL
    private let script: URL
    private var process: Process?
    private var input: Pipe?
    private var restarts = 0
    private var stopping = false
    private var errorText = ""

    init(resources: URL) {
        node = resources.appendingPathComponent("node")
        script = resources.appendingPathComponent("server/server.js")
    }

    func start() {
        stopping = false
        errorText = ""
        state = .starting

        let process = Process()
        process.executableURL = node
        process.arguments = [script.path]
        // A Finder launch has a bare environment; the server shells out to lsof and ps.
        process.environment = [
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "USER": NSUserName(),
            "HOME": NSHomeDirectory(),
            "PORT_DESK_EXIT_ON_STDIN_CLOSE": "1",
        ]

        let input = Pipe()
        let output = Pipe()
        let errors = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errors

        var seen = ""
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            seen += String(decoding: data, as: UTF8.self)
            guard seen.contains("\n"),
                  let range = seen.range(of: #"http://127\.0\.0\.1:\d+"#, options: .regularExpression),
                  let url = URL(string: String(seen[range]))
            else { return }
            handle.readabilityHandler = nil
            DispatchQueue.main.async { self?.state = .running(url) }
        }
        errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            let text = String(decoding: data, as: UTF8.self)
            DispatchQueue.main.async { self?.errorText = String((self?.errorText ?? "").suffix(400) + text) }
        }
        process.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async { self?.didExit(finished) }
        }

        do {
            try process.run()
        } catch {
            state = .failed("Could not start the server: \(error.localizedDescription)")
            return
        }
        self.process = process
        self.input = input
    }

    /// Manual restart from the error screen; gives the server a fresh automatic-restart allowance.
    func restart() {
        stop()
        restarts = 0
        start()
    }

    func stop() {
        stopping = true
        try? input?.fileHandleForWriting.close()
        process?.terminate()
        process = nil
        input = nil
    }

    private func didExit(_ finished: Process) {
        guard finished === process, !stopping else { return }
        process = nil
        input = nil
        if restarts < 1 {
            restarts += 1
            start()
            return
        }
        let detail = errorText.trimmingCharacters(in: .whitespacesAndNewlines)
        state = .failed(detail.isEmpty ? "The server stopped (exit status \(finished.terminationStatus))." : detail)
    }
}
