import SwiftUI

@main
struct PayuuCaptureApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Image(systemName: "iphone.gen3.radiowaves.left.and.right")
                    .font(.system(size: 56))
                Text("Payuu Capture")
                    .font(.largeTitle.bold())
                Text("Native capture companion for iPhone/iPad. Pair with Payuu Studio to send screen, device audio and microphone to your production session.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            .padding()
            .navigationTitle("Payuu Capture")
        }
    }
}
