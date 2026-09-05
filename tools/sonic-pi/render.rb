# Renders Fishtank's Sonic Pi pieces to 24-bit WAV files in one engine session.
#
#   "/Applications/Sonic Pi.app/Contents/Resources/app/server/native/ruby/bin/ruby" \
#     tools/sonic-pi/render.rb OUT_DIR music-menu=70 chomp=2 ...
#
# Each NAME maps to tools/sonic-pi/NAME.rb and is recorded for that many
# seconds (realtime, and audible while it renders). Adapted from Sonic Pi 5's
# headless-record.rb and headless_boot.rb (MIT). That harness pings the daemon
# every 4 s while the daemon's kill switch wants a keep-alive more often than
# every 3 s, so takes die after a few seconds; this one pings every second and
# reuses a single boot for every piece. Recording goes through the spider's own
# /start-recording, /stop-recording and /save-recording (what the GUI uses),
# because the engine only speaks OSC over TCP and refuses the harness's UDP.
# Needs the real audio device: it will not run inside a sandbox that blocks
# CoreAudio.
require 'open3'
require 'fileutils'

APP = ENV.fetch('SONIC_PI_APP', '/Applications/Sonic Pi.app')
SERVER = File.join(APP, 'Contents/Resources/app/server/ruby')
abort "Sonic Pi not found at #{APP} (set SONIC_PI_APP)" unless File.directory?(SERVER)
require File.join(SERVER, 'lib/sonicpi/osc/osc')
require File.join(SERVER, 'paths')
require File.join(SERVER, 'lib/sonicpi/promise')

USAGE = 'Usage: render.rb OUT_DIR name=seconds [name=seconds ...]'
out_dir = ARGV.shift or abort USAGE
pieces = ARGV.map { |arg| name, seconds = arg.split('='); [name, seconds.to_f] }
abort USAGE if pieces.empty? || pieces.any? { |_, s| s <= 0 }
pieces.each { |name, _| abort "No such piece: #{name}.rb" unless File.exist?(File.join(__dir__, "#{name}.rb")) }
FileUtils.mkdir_p(out_dir)

def say(msg)
  puts "[render] #{msg}"
  STDOUT.flush
end

_stdin, daemon_out, daemon_wait = Open3.popen2e(SonicPi::Paths.ruby_path, SonicPi::Paths.daemon_path)
say "daemon pid #{daemon_wait.pid}"
daemon_port, gui_listen, gui_send, _engine_port, _cues, token = daemon_out.gets.split.map(&:to_i)
Thread.new { daemon_out.each_line { } }
keep_alive = SonicPi::OSC::UDPClient.new('127.0.0.1', daemon_port)
Thread.new { loop { (keep_alive.send('/daemon/keep-alive', token) rescue nil); sleep 1 } }
spider = SonicPi::OSC::UDPClient.new('127.0.0.1', gui_send)

server_ready = SonicPi::Promise.new
engine_ready = SonicPi::Promise.new
errors = []
incoming = SonicPi::OSC::UDPServer.new(gui_listen)
incoming.add_method('/ack') { server_ready.deliver!(true) rescue nil }
incoming.add_method('/supersonic/info') { |_m| engine_ready.deliver!(true) rescue nil }
incoming.add_method('/log/info') do |m|
  engine_ready.deliver!(true) rescue nil if m[1].to_s.include?('Live Coding begin')
end
incoming.add_method('/error') do |m|
  errors << "#{m[1]} (line #{m[3]})"
  say "ERROR #{m[1]} line #{m[3]}: #{m[2]}"
end
incoming.add_method('/syntax_error') do |m|
  errors << "syntax: #{m[1]} (line #{m[3]})"
  say "SYNTAX ERROR #{m[1]} line #{m[3]}: #{m[2]}"
end
Thread.new do
  until server_ready.delivered?
    (spider.send('/ping', token, 'hello') rescue nil)
    sleep 0.5
  end
end
say 'waiting for the engine...'
server_ready.get
engine_ready.get
sleep 1

pieces.each do |name, seconds|
  code = File.read(File.join(__dir__, "#{name}.rb"))
  out = File.expand_path(File.join(out_dir, "#{name}.wav"))
  File.delete(out) if File.exist?(out)
  before = errors.size
  say "#{name}: recording #{seconds}s"
  spider.send('/start-recording', token)
  sleep 0.5
  spider.send('/run-code', token, code)
  sleep seconds
  spider.send('/stop-recording', token)
  spider.send('/stop-all-jobs', token)
  sleep 1
  spider.send('/save-recording', token, out)
  sleep 1.5
  size = File.exist?(out) ? File.size(out) : 0
  say "#{name}: #{size > 0 ? "#{size} bytes" : 'MISSING'}#{errors.size > before ? ' with errors' : ''}"
  errors << "#{name}: no output" if size == 0
end

(spider.send('/exit', token) rescue nil)
(keep_alive.send('/daemon/exit', token) rescue nil)
sleep 1
say(errors.empty? ? 'done' : "done with problems: #{errors.join(' | ')}")
exit(errors.empty? ? 0 : 2)
