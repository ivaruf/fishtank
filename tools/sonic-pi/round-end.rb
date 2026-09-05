# Round over: a bright bell chord over a soft pad.
with_fx :reverb, room: 0.85, mix: 0.5 do
  use_synth :pretty_bell
  play_chord [:d5, :a5, :f6], release: 3, amp: 0.55
  sleep 0.25
  play :d6, release: 2.5, amp: 0.4
  use_synth :hollow
  play chord(:d4, :minor7), attack: 0.2, sustain: 1.5, release: 2, amp: 0.9
end
